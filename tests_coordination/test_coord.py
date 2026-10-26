import copy
from datetime import datetime, timezone, timedelta
import importlib.util
from pathlib import Path
import unittest

path=Path(__file__).parents[1]/'scripts/coord.py'
spec=importlib.util.spec_from_file_location('coord',path)
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
NOW=datetime(2026,10,17,12,tzinfo=timezone.utc)
MANIFEST={'tasks':[
    {'id':'P00','title':'base','depends_on':[],'resources':['base']},
    {'id':'P01','title':'agenda','depends_on':['P00'],'resources':['agenda']},
    {'id':'P02','title':'agenda2','depends_on':['P00'],'resources':['agenda']},
    {'id':'P03','title':'preco','depends_on':['P00'],'resources':['preco']}]}

class MemoryStore:
    def __init__(self,board):self.board=copy.deepcopy(board);self.version=1;self.race=None
    def read(self):return copy.deepcopy(self.board),str(self.version)
    def write(self,value,sha):
        if self.race:
            race,self.race=self.race,None;race(self)
        if sha!=str(self.version):raise c.Conflict('stale')
        self.board=copy.deepcopy(value);self.version+=1

class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.board=c.new_board(MANIFEST,['felipe'],NOW)
    def ready(self):
        self.board['tasks']['P00']['status']='done'
        return self.board
    def claim(self,board,task='P01',actor='felipe',session='felipe-one',now=NOW):
        return c.transition(board,'claim',task,actor,session,now)
    def test_dependency_blocks_claim(self):
        with self.assertRaises(c.BoardError):self.claim(self.board)
    def test_claim_assigns_branch_and_lease(self):
        b=self.claim(self.ready());t=b['tasks']['P01']
        self.assertEqual(t['branch'],'task/p01/felipe-one')
        self.assertEqual(c.parsed(t['lease_until']),NOW+timedelta(hours=2))
    def test_same_task_cannot_be_claimed_twice(self):
        b=self.claim(self.ready())
        with self.assertRaises(c.BoardError):self.claim(b,actor='gabriel',session='gabriel-one')
    def test_shared_resource_blocks_other_package(self):
        b=self.claim(self.ready())
        with self.assertRaises(c.BoardError):self.claim(b,task='P02',session='felipe-two')
    def test_other_session_same_account_cannot_heartbeat(self):
        b=self.claim(self.ready())
        with self.assertRaises(c.BoardError):c.transition(b,'heartbeat','P01','felipe','felipe-other',NOW)
    def test_expiry_does_not_allow_steal(self):
        b=self.claim(self.ready());later=NOW+timedelta(hours=3)
        with self.assertRaises(c.BoardError):self.claim(b,actor='gabriel',session='gabriel-one',now=later)
        with self.assertRaises(c.BoardError):c.assert_owner(b['tasks']['P01'],'felipe','felipe-one',later)
    def test_expired_heartbeat_denied(self):
        b=self.claim(self.ready())
        with self.assertRaises(c.BoardError):c.transition(b,'heartbeat','P01','felipe','felipe-one',NOW+timedelta(hours=3))
    def test_reset_requires_integrator_and_stop_confirmation(self):
        b=self.claim(self.ready())
        for actor,stopped in [('gabriel',True),('felipe',False)]:
            with self.assertRaises(c.BoardError):c.transition(b,'reset','P01',actor,None,NOW,reason='handoff',confirm_stopped=stopped)
        reset=c.transition(b,'reset','P01','felipe',None,NOW,reason='stopped',confirm_stopped=True)
        self.assertEqual(reset['tasks']['P01']['status'],'pending')
        with self.assertRaises(c.BoardError):c.assert_owner(reset['tasks']['P01'],'felipe','felipe-one',NOW)
    def test_conflicting_claim_race_loser_fails(self):
        store=MemoryStore(self.ready())
        def winner(s):
            s.board=self.claim(s.board,actor='gabriel',session='gabriel-one');s.version+=1
        store.race=winner
        with self.assertRaises(c.BoardError):c.cas_update(store,lambda b:self.claim(b),pause=False)
        self.assertEqual(store.board['tasks']['P01']['owner'],'gabriel')
    def test_independent_race_preserves_both_updates(self):
        store=MemoryStore(self.ready())
        def winner(s):
            s.board=self.claim(s.board,task='P03',actor='gabriel',session='gabriel-one');s.version+=1
        store.race=winner
        result=c.cas_update(store,lambda b:self.claim(b),pause=False)
        self.assertEqual(result['tasks']['P01']['owner'],'felipe')
        self.assertEqual(result['tasks']['P03']['owner'],'gabriel')
    def test_review_and_finish_require_correct_pr(self):
        b=self.claim(self.ready());info={'state':'open','head':{'ref':'task/p01/felipe-one'},'base':{'ref':'main'}}
        b=c.transition(b,'review','P01','felipe','felipe-one',NOW,pr=42,pr_info=info)
        with self.assertRaises(c.BoardError):c.transition(b,'finish','P01','felipe',None,NOW,pr=42,pr_info=info)
        info.update(merged=True,merge_commit_sha='abc123')
        b=c.transition(b,'finish','P01','felipe',None,NOW,pr=42,pr_info=info)
        self.assertEqual(b['tasks']['P01']['status'],'done')
        self.assertFalse(c.reasons_unavailable(b,b['tasks']['P02']))
    def test_wrong_branch_not_accepted(self):
        b=self.claim(self.ready());info={'state':'open','head':{'ref':'other'},'base':{'ref':'main'}}
        with self.assertRaises(c.BoardError):c.transition(b,'review','P01','felipe','felipe-one',NOW,pr=42,pr_info=info)
    def test_block_keeps_resource_reserved(self):
        b=self.claim(self.ready());b=c.transition(b,'block','P01','felipe','felipe-one',NOW,reason='contract')
        with self.assertRaises(c.BoardError):self.claim(b,task='P02',session='felipe-two')
    def test_cycle_rejected(self):
        m=copy.deepcopy(MANIFEST);m['tasks'][0]['depends_on']=['P01']
        with self.assertRaises(c.BoardError):c.validate_manifest(m)
    def test_missing_dependency_rejected(self):
        m=copy.deepcopy(MANIFEST);m['tasks'][0]['depends_on']=['P99']
        with self.assertRaises(c.BoardError):c.validate_manifest(m)
    def test_independent_tasks_can_run(self):
        b=self.claim(self.ready());b=self.claim(b,task='P03',actor='gabriel',session='gabriel-one')
        self.assertEqual(sum(t['status']=='in_progress' for t in b['tasks'].values()),2)
    def test_resume_paused_owner_preserves_branch(self):
        b=self.claim(self.ready());b=c.transition(b,'block','P01','felipe','felipe-one',NOW,reason='contract')
        with self.assertRaises(c.BoardError):c.transition(b,'resume','P01','gabriel','gabriel-one',NOW)
        b=c.transition(b,'resume','P01','felipe','felipe-one',NOW+timedelta(hours=3))
        self.assertEqual(b['tasks']['P01']['status'],'in_progress')
        self.assertEqual(b['tasks']['P01']['branch'],'task/p01/felipe-one')
    def test_resume_does_not_revive_expired_writer(self):
        b=self.claim(self.ready())
        with self.assertRaises(c.BoardError):c.transition(b,'resume','P01','felipe','felipe-one',NOW+timedelta(hours=3))
    def test_remote_adapter_uses_expected_sha_and_dedicated_branch(self):
        g=c.GithubStore('owner/repo');calls=[]
        g.api=lambda *a,**kw:calls.append((a,kw)) or {}
        g.write(self.board,'expected-blob-sha')
        payload=calls[0][0][2]
        self.assertEqual(payload['sha'],'expected-blob-sha')
        self.assertEqual(payload['branch'],'coordination')
    def test_remote_adapter_exposes_every_command_method(self):
        # review/finish com --pr e init dependem destes métodos; uma função no meio da classe já os escondeu.
        for name in ['actor','read','write','initialize','pull_request']:
            self.assertTrue(callable(getattr(c.GithubStore,name,None)),name)
    def test_pull_request_rejects_fork(self):
        g=c.GithubStore('owner/repo')
        g.api=lambda *a,**kw:{'base':{'repo':{'full_name':'owner/repo'}},'head':{'repo':{'full_name':'fork/repo'}}}
        with self.assertRaises(c.BoardError):g.pull_request(42)
        g.api=lambda *a,**kw:{'base':{'repo':{'full_name':'owner/repo'}},'head':{'repo':{'full_name':'Owner/Repo'}},'number':42}
        self.assertEqual(g.pull_request(42)['number'],42)
    def test_repository_argument_rejects_shell_or_path_injection(self):
        for repo in ['owner/repo;cmd','../x/y','https://github.com/o/r']:
            with self.assertRaises(c.BoardError):c.GithubStore(repo)
    def test_advance_cannot_skip_unfinished_phase(self):
        manifest={'phase':'growth','tasks':[{'id':'P11','title':'next','depends_on':['P03'],'resources':['next']}]}
        with self.assertRaises(c.BoardError):c.advance_phase(self.board,manifest,'felipe',NOW)
    def test_advance_preserves_history_and_validates_owner(self):
        for task in self.board['tasks'].values():task['status']='done'
        manifest={'phase':'growth','tasks':[{'id':'P11','title':'next','depends_on':['P03'],'resources':['next']}]}
        with self.assertRaises(c.BoardError):c.advance_phase(self.board,manifest,'gabriel',NOW)
        b=c.advance_phase(self.board,manifest,'felipe',NOW)
        self.assertEqual(b['phase'],'growth');self.assertEqual(b['tasks']['P00']['status'],'done')
        self.assertFalse(c.reasons_unavailable(b,b['tasks']['P11']))

if __name__=='__main__':unittest.main()

class GitFallbackTests(unittest.TestCase):
    """Escrita por git quando a Contents API recusa (403): só grava sobre o blob lido; mudou no meio = conflito."""
    def setUp(self):
        import os, subprocess, tempfile
        self.os, self.sp = os, subprocess
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.remote, self.work = root / 'remote.git', root / 'work'
        run = lambda *a, cwd=None: subprocess.run(['git', *a], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
        self.run = run
        run('init', '--quiet', '--bare', str(self.remote))
        run('init', '--quiet', str(self.work))
        for k, v in (('user.name', 'teste'), ('user.email', 'teste@exemplo.test')):
            run('config', k, v, cwd=self.work)
        (self.work / 'workboard.json').write_text('{"v": 1}\n')
        run('add', 'workboard.json', cwd=self.work)
        run('commit', '--quiet', '-m', 'init', cwd=self.work)
        run('remote', 'add', 'origin', str(self.remote), cwd=self.work)
        run('push', '--quiet', 'origin', 'HEAD:refs/heads/coordination', cwd=self.work)
        self.prev = os.getcwd(); os.chdir(self.work)
    def tearDown(self):
        self.os.chdir(self.prev); self.tmp.cleanup()
    def blob(self):
        return self.run('rev-parse', 'refs/heads/coordination:workboard.json', cwd=self.remote)
    def test_writes_on_top_of_read_blob(self):
        c.git_cas_write('{"v": 2}\n', self.blob())
        self.assertEqual(self.run('show', 'refs/heads/coordination:workboard.json', cwd=self.remote), '{"v": 2}')
    def test_stale_sha_is_conflict_and_changes_nothing(self):
        stale = self.blob()
        c.git_cas_write('{"v": 2}\n', stale)
        with self.assertRaises(c.Conflict):
            c.git_cas_write('{"v": 3}\n', stale)
        self.assertEqual(self.run('show', 'refs/heads/coordination:workboard.json', cwd=self.remote), '{"v": 2}')
