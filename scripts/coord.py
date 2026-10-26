#!/usr/bin/env python3
"""Tinindo cooperative work reservation. No product data or production access.

Remote authority: coordination:workboard.json. Updates use the blob SHA returned
by GitHub's Contents API and retry conflicts by rereading and revalidating.
Where the Contents API refuses writes (HTTP 403, e.g. a cloud session proxy), the
same compare-and-swap is done with git: the commit is created only if the board
blob on coordination still has the SHA that was read, and a non-fast-forward
push is treated as a conflict.
This is coordination among trusted collaborators, not a security boundary.
"""
from __future__ import annotations
import argparse
import base64
import copy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import random
import re
import subprocess
import sys
import time
import uuid

ACTIVE = {'in_progress', 'review', 'blocked'}
LEASE_MINUTES = 120

class BoardError(Exception):
    pass

class Conflict(BoardError):
    pass

class ApiError(BoardError):
    def __init__(self, code: int | None):
        self.code = code
        super().__init__(f'GitHub API falhou (HTTP {code or "desconhecido"}); não presumir que uma escrita falhou. Consulte status antes de repetir.')

def utcnow():
    return datetime.now(timezone.utc)

def iso(value):
    return value.isoformat().replace('+00:00', 'Z')

def parsed(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def validate_manifest(manifest):
    tasks = manifest.get('tasks', [])
    ids = [t['id'] for t in tasks]
    if not ids or len(ids) != len(set(ids)):
        raise BoardError('Manifest vazio ou IDs duplicados.')
    mapping = {t['id']: t for t in tasks}
    for task in tasks:
        if not re.fullmatch(r'P\d{2}', task['id']):
            raise BoardError('ID inválido.')
        if not task.get('resources') or not all(isinstance(x, str) and x for x in task['resources']):
            raise BoardError('Recursos exclusivos obrigatórios.')
        if set(task.get('depends_on', [])) - set(ids):
            raise BoardError('Dependência inexistente.')
    def visit(key, stack, seen):
        if key in stack:
            raise BoardError('Ciclo de dependências.')
        if key in seen:
            return
        for dep in mapping[key].get('depends_on', []):
            visit(dep, stack | {key}, seen)
        seen.add(key)
    seen = set()
    for key in ids:
        visit(key, set(), seen)

def new_board(manifest, integrators, now):
    validate_manifest(manifest)
    if not integrators:
        raise BoardError('Defina pelo menos um integrador.')
    tasks = {}
    for definition in manifest['tasks']:
        task = copy.deepcopy(definition)
        task.update(status='pending', owner=None, session=None, branch=None,
                    lease_until=None, pr=None, block_reason=None)
        tasks[task['id']] = task
    return dict(schema_version=1, phase=manifest.get('phase','pilot'),
                integrators=list(dict.fromkeys(integrators)), tasks=tasks,
                updated_at=iso(now), history=[])

def task_for(board, task_id):
    try:
        return board['tasks'][task_id]
    except KeyError:
        raise BoardError(f'Tarefa inexistente: {task_id}') from None

def reasons_unavailable(board, task):
    reasons=[]
    if task['status'] != 'pending':
        reasons.append('estado=' + task['status'])
    deps=[d for d in task.get('depends_on', []) if task_for(board,d)['status'] != 'done']
    if deps:
        reasons.append('dependências=' + ','.join(deps))
    conflicts=[t['id'] for t in board['tasks'].values()
               if t['id'] != task['id'] and t['status'] in ACTIVE
               and set(t['resources']) & set(task['resources'])]
    if conflicts:
        reasons.append('recursos reservados=' + ','.join(conflicts))
    return reasons

def assert_owner(task, actor, session, now, require_writing=True):
    if task['owner'] != actor or task['session'] != session:
        raise BoardError('Reserva pertence a outra pessoa/sessão. Pare de escrever.')
    if require_writing and task['status'] != 'in_progress':
        raise BoardError('Sessão não está em implementação; consulte integrador.')
    if not task['lease_until'] or parsed(task['lease_until']) <= now:
        raise BoardError('Reserva vencida. Pare; integrador deve recuperar explicitamente.')

def transition(board, action, task_id, actor, session, now, *, pr=None,
               reason=None, confirm_stopped=False, pr_info=None):
    result=copy.deepcopy(board)
    task=task_for(result,task_id)
    if action == 'claim':
        if not session or not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,60}', session):
            raise BoardError('Sessão: 3–61 caracteres minúsculos, números e hífen.')
        if any(t['session'] == session and t['status'] != 'done' for t in result['tasks'].values()):
            raise BoardError('ID de sessão já usado. Consulte status ou use ID novo.')
        unavailable=reasons_unavailable(result,task)
        if unavailable:
            raise BoardError('Tarefa indisponível: ' + '; '.join(unavailable))
        task.update(status='in_progress', owner=actor, session=session,
                    branch=f'task/{task_id.lower()}/{session}',
                    lease_until=iso(now+timedelta(minutes=LEASE_MINUTES)), block_reason=None)
    elif action == 'resume':
        if task['owner'] != actor or task['session'] != session or task['status'] not in ('review','blocked'):
            raise BoardError('Somente o dono pode retomar sua sessão pausada em review/blocked.')
        # Review/blocked hold the resource but forbid writing. Explicit resume by
        # the same owner is safe even after the paused lease timestamp elapsed;
        # expired in_progress writers still require integrator recovery.
        task.update(status='in_progress',block_reason=None,
                    lease_until=iso(now+timedelta(minutes=LEASE_MINUTES)))
    elif action in ('heartbeat','review','block'):
        assert_owner(task,actor,session,now)
        if action == 'heartbeat':
            task['lease_until']=iso(now+timedelta(minutes=LEASE_MINUTES))
        elif action == 'block':
            if not reason or not reason.strip():
                raise BoardError('Motivo obrigatório.')
            task.update(status='blocked', block_reason=reason)
        else:
            if not pr or not pr_info or pr_info.get('state') != 'open':
                raise BoardError('PR aberto verificado é obrigatório.')
            if pr_info.get('head',{}).get('ref') != task['branch']:
                raise BoardError('Branch do PR não corresponde à reserva.')
            if pr_info.get('base',{}).get('ref') != 'main':
                raise BoardError('PR deve mirar main.')
            task.update(status='review', pr=pr)
    elif action in ('finish','reset'):
        if actor not in result['integrators']:
            raise BoardError('Ação exclusiva de integrador registrado.')
        if action == 'reset':
            if task['status'] not in ACTIVE:
                raise BoardError('Reset só para tarefa ativa/bloqueada; done não pode ser reaberto automaticamente.')
            if not confirm_stopped or not reason or not reason.strip():
                raise BoardError('Confirme sessão anterior parada e registre motivo.')
            task.update(status='pending',owner=None,session=None,branch=None,
                        lease_until=None,pr=None,block_reason=None)
        else:
            if task['status'] != 'review' or task.get('pr') != pr:
                raise BoardError('Pacote precisa estar em review com este PR registrado.')
            if not pr_info or not pr_info.get('merged') or pr_info.get('base',{}).get('ref') != 'main':
                raise BoardError('PR merged em main é obrigatório.')
            if pr_info.get('head',{}).get('ref') != task['branch'] or not pr_info.get('merge_commit_sha'):
                raise BoardError('PR/commit não corresponde à reserva.')
            task.update(status='done',merge_sha=pr_info['merge_commit_sha'],lease_until=None)
    else:
        raise BoardError('Transição desconhecida.')
    result['updated_at']=iso(now)
    result['history']=(result.get('history',[])+[dict(id=str(uuid.uuid4()),at=iso(now),
                         action=action,task=task_id,actor=actor,session=session,pr=pr,
                         reason=reason)])[-200:]
    return result

def cas_update(store, transform, attempts=5, pause=True):
    """Reapply preconditions against each refreshed state; never last-write-wins."""
    for attempt in range(attempts):
        board,sha=store.read()
        candidate=transform(board)
        try:
            store.write(candidate,sha)
            return candidate
        except Conflict:
            if attempt == attempts-1:
                raise BoardError('Contenção persistente; consulte status e tente novamente.')
            if pause:
                time.sleep(random.uniform(.08,.35)*(attempt+1))
    raise BoardError('Atualização não concluída.')

def advance_phase(board, manifest, actor, now):
    if actor not in board['integrators']:
        raise BoardError('Somente integrador pode abrir nova fase.')
    if any(t['status'] != 'done' for t in board['tasks'].values()):
        raise BoardError('Conclua a fase atual antes de abrir outra.')
    if not manifest.get('phase') or manifest['phase'] == board['phase']:
        raise BoardError('Defina uma nova fase explicitamente.')
    fresh=manifest.get('tasks',[])
    if not fresh or any(t['id'] in board['tasks'] for t in fresh):
        raise BoardError('Nova fase precisa de tarefas novas, sem reutilizar IDs.')
    validate_manifest({'tasks':list(board['tasks'].values())+fresh})
    result=copy.deepcopy(board)
    for definition in fresh:
        task=copy.deepcopy(definition)
        task.update(status='pending',owner=None,session=None,branch=None,
                    lease_until=None,pr=None,block_reason=None)
        result['tasks'][task['id']]=task
    result['phase']=manifest['phase'];result['updated_at']=iso(now)
    result['history']=(result['history']+[dict(id=str(uuid.uuid4()),at=iso(now),
                         action='advance',actor=actor,phase=result['phase'])])[-200:]
    return result

class GithubStore:
    def __init__(self,repo):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',repo):
            raise BoardError('Repo deve ter formato OWNER/REPO.')
        self.repo=repo
        self.path=f'repos/{repo}/contents/workboard.json'

    def api(self,method,path,payload=None,query=None):
        command=['gh','api','--method',method,path,'-H','Accept: application/vnd.github+json']
        if query:
            for key,value in query.items():
                command.extend(['-f',f'{key}={value}'])
        if payload is not None:
            command.extend(['--input','-'])
        try:
            process=subprocess.run(command,input=json.dumps(payload) if payload is not None else None,
                    text=True,capture_output=True,timeout=45)
        except (FileNotFoundError,subprocess.TimeoutExpired) as exc:
            raise BoardError('gh ausente ou timeout. Verifique instalação/rede; consulte status antes de repetir escrita.') from exc
        if process.returncode:
            match=re.search(r'HTTP\s+(\d{3})',process.stderr)
            code=int(match.group(1)) if match else None
            if code==409:
                raise Conflict('SHA desatualizado ou conflito de branch.')
            raise ApiError(code)
        try:
            return json.loads(process.stdout) if process.stdout.strip() else {}
        except json.JSONDecodeError as exc:
            raise BoardError('Resposta GitHub inválida; consulte status.') from exc

    def actor(self):
        return self.api('GET','user')['login']

    def read(self):
        response=self.api('GET',self.path,query={'ref':'coordination'})
        if response.get('encoding') != 'base64':
            raise BoardError('Formato inesperado do quadro.')
        board=json.loads(base64.b64decode(response['content']).decode())
        if board.get('schema_version') != 1:
            raise BoardError('Versão de quadro não suportada.')
        return board,response['sha']

    def write(self,board,sha):
        text=json.dumps(board,ensure_ascii=False,indent=2)+'\n'
        content=base64.b64encode(text.encode()).decode()
        payload={'message':'coord: update work reservations','content':content,'branch':'coordination'}
        if sha is not None:
            payload['sha']=sha
        try:
            self.api('PUT',self.path,payload)
        except ApiError as exc:
            if exc.code!=403 or sha is None:
                raise
            git_cas_write(text,sha)

def git(*args,input=None):
    process=subprocess.run(['git',*args],input=input,text=True,capture_output=True,timeout=60)
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode,args,process.stdout,process.stderr)
    return process.stdout.strip()

def git_cas_write(text,expected_sha,remote='origin',branch='coordination',path='workboard.json'):
    """Compare-and-swap by git: commit only on top of the board blob that was read; never force-push."""
    try:
        git('fetch','--quiet',remote,f'+refs/heads/{branch}:refs/coord/{branch}')
        current=git('rev-parse',f'refs/coord/{branch}:{path}')
        if current!=expected_sha:
            raise Conflict('SHA desatualizado (git).')
        blob=git('hash-object','-w','--stdin',input=text)
        entries=[line for line in git('ls-tree',f'refs/coord/{branch}').splitlines() if not line.endswith('\t'+path)]
        tree=git('mktree',input='\n'.join(entries+[f'100644 blob {blob}\t{path}'])+'\n')
        commit=git('commit-tree',tree,'-p',f'refs/coord/{branch}','-m','coord: update work reservations')
    except subprocess.CalledProcessError as exc:
        raise BoardError('Escrita por git falhou antes do push; nada foi alterado. Consulte status.') from exc
    try:
        git('push','--quiet',remote,f'{commit}:refs/heads/{branch}')
    except subprocess.CalledProcessError as exc:
        if 'non-fast-forward' in exc.stderr or 'rejected' in exc.stderr or 'fetch first' in exc.stderr:
            raise Conflict('Quadro mudou durante a escrita (git).') from exc
        raise BoardError('Push do quadro falhou; não presumir que a escrita falhou. Consulte status antes de repetir.') from exc

    def initialize(self,board):
        # Verify branch and access first. A masked 404 is not treated as permission to create elsewhere.
        self.api('GET',f'repos/{self.repo}/git/ref/heads/coordination')
        try:
            self.read()
        except ApiError as exc:
            if exc.code!=404:
                raise
        else:
            raise BoardError('Quadro já existe. Não sobrescrever; consulte status.')
        self.write(board,None)

    def pull_request(self,number):
        info=self.api('GET',f'repos/{self.repo}/pulls/{number}')
        base_repo=info.get('base',{}).get('repo',{}).get('full_name','')
        head_repo=(info.get('head',{}).get('repo') or {}).get('full_name','')
        if base_repo.lower()!=self.repo.lower() or head_repo.lower()!=self.repo.lower():
            raise BoardError('PR deve pertencer ao repositório canônico, sem fork externo.')
        return info

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',required=True,help='Repositório canônico OWNER/REPO')
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('status')
    init=sub.add_parser('init')
    init.add_argument('--integrators',nargs='+',required=True)
    init.add_argument('--manifest',default='coordination/manifest.json')
    advance=sub.add_parser('advance')
    advance.add_argument('--manifest',required=True,help='Manifest revisado da próxima fase, IDs novos P11–P99')
    for name in ('claim','assert','heartbeat','review','block','resume','reset','finish'):
        p=sub.add_parser(name);p.add_argument('task')
        if name in ('claim','assert','heartbeat','review','block','resume'):
            p.add_argument('--session',required=True)
        if name in ('review','finish'):
            p.add_argument('--pr',type=int,required=True)
        if name in ('block','reset'):
            p.add_argument('--reason',required=True)
        if name=='reset':
            p.add_argument('--confirm-stopped',action='store_true')
    args=parser.parse_args()
    store=GithubStore(args.repo)
    actor=store.actor()
    now=utcnow()
    if args.command=='init':
        if actor not in args.integrators:
            raise BoardError('O inicializador deve ser um integrador registrado.')
        for login in args.integrators:
            if not re.fullmatch(r'[A-Za-z0-9-]+',login):
                raise BoardError('Login inválido.')
            perm=store.api('GET',f'repos/{args.repo}/collaborators/{login}/permission').get('permission')
            if perm not in ('admin','maintain','write'):
                raise BoardError(f'{login} não tem escrita no repositório.')
        manifest=json.loads(Path(args.manifest).read_text())
        board=new_board(manifest,args.integrators,now)
        store.initialize(board)
        print('Quadro inicializado. Nenhuma tarefa marcada como concluída.')
        return
    if args.command=='advance':
        manifest=json.loads(Path(args.manifest).read_text())
        result=cas_update(store,lambda board:advance_phase(board,manifest,actor,utcnow()))
        print(json.dumps({'phase':result['phase'],'tasks':list(result['tasks'])},ensure_ascii=False))
        return
    if args.command=='status':
        board,sha=store.read()
        summary=[]
        for task in board['tasks'].values():
            entry={k:task.get(k) for k in ('id','title','status','owner','session','branch','lease_until','pr','block_reason')}
            entry['available']=not reasons_unavailable(board,task)
            entry['waiting']=reasons_unavailable(board,task)
            entry['lease_expired']=bool(task.get('lease_until') and parsed(task['lease_until'])<=now and task['status']=='in_progress')
            summary.append(entry)
        print(json.dumps({'actor':actor,'phase':board['phase'],'blob_sha':sha,'tasks':summary},ensure_ascii=False,indent=2))
        return
    if args.command=='assert':
        board,_=store.read();task=task_for(board,args.task)
        assert_owner(task,actor,args.session,now)
        print(json.dumps({'ok':True,'task':task['id'],'branch':task['branch'],'lease_until':task['lease_until']}))
        return
    pr=getattr(args,'pr',None)
    pr_info=store.pull_request(pr) if pr else None
    result=cas_update(store,lambda board:transition(board,args.command,args.task,actor,
                    getattr(args,'session',None),utcnow(),pr=pr,
                    reason=getattr(args,'reason',None),confirm_stopped=getattr(args,'confirm_stopped',False),
                    pr_info=pr_info))
    print(json.dumps(result['tasks'][args.task],ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:
        main()
    except (BoardError,OSError,ValueError,KeyError) as exc:
        print(f'ERRO: {exc}',file=sys.stderr)
        sys.exit(2)
