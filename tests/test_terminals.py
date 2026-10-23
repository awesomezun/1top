import unittest
from onetop.server import terminal_for, bind_terminal


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.tabs=[dict(handle='a',tabId='ta',title='slide',worktreePath='/work/p'),
                   dict(handle='b',tabId='tb',title='Goal',worktreePath='/work/p')]
        self.meta={1:dict(orca_handle='a',tmux_pane='%1'),
                   2:dict(orca_handle='b',tmux_pane='%2')}
        self.spec=dict(id='one',kind='Codex',pids=[1,2],cwd='/work/p',thread_name='Slides')
        self.panes={'%1':'⠧ Slides | p','%2':'Summary | p'}

    def test_handle_wins_over_tab_fallback_and_names_refresh(self):
        self.assertEqual(terminal_for(dict(orca_handle='a',orca_tab='tb'),self.tabs)['title'],'slide')
        self.tabs[0]['title']='Renamed'
        self.assertEqual(terminal_for(self.meta[1],self.tabs)['title'],'Renamed')

    def test_unique_tab_fallback_and_missing_identity(self):
        self.assertEqual(terminal_for(dict(orca_handle='stale',orca_tab='tb'),self.tabs)['title'],'Goal')
        self.assertIsNone(terminal_for(dict(cwd='/work/p'),self.tabs))
        self.assertIsNone(terminal_for(dict(orca_tab='tb'),self.tabs+[self.tabs[1]]))

    def test_codex_same_directory_threads_get_their_own_terminal(self):
        other={**self.spec,'id':'two','thread_name':'Summary'}
        specs=[self.spec,other]
        for spec in specs:bind_terminal(spec,self.meta,self.tabs,self.panes,specs)
        self.assertEqual(self.spec['orca_terminal']['title'],'slide')
        self.assertEqual(other['orca_terminal']['title'],'Goal')
        self.assertEqual(self.spec['pids'],[1]);self.assertEqual(other['pids'],[2])

    def test_duplicate_thread_names_are_not_guessed(self):
        specs=[self.spec,{**self.spec,'id':'two'}]
        bind_terminal(self.spec,self.meta,self.tabs,self.panes,specs)
        self.assertIsNone(self.spec['orca_terminal'])

    def test_stale_partial_or_duplicate_pane_titles_are_not_guessed(self):
        for panes in [{'%%1':'Slides | p'},{'%1':'Slides extra | p'},
                      {'%1':'Slides | wrong-project'},
                      {'%1':'Slides | p','%2':'⠏ Slides | p'}]:
            spec={**self.spec}
            bind_terminal(spec,self.meta,self.tabs,panes,[spec])
            self.assertIsNone(spec['orca_terminal'])

    def test_closed_orca_tab_is_not_replaced_with_other_project_tab(self):
        bind_terminal(self.spec,self.meta,[self.tabs[1]],self.panes,[self.spec])
        self.assertIsNone(self.spec['orca_terminal'])
        self.assertEqual(self.spec['terminal_match'],'unavailable')

    def test_claude_joins_by_process_identity_without_title_inference(self):
        spec={**self.spec,'kind':'Claude','pids':[2]}
        bind_terminal(spec,self.meta,self.tabs,{},[spec])
        self.assertEqual(spec['orca_terminal']['title'],'Goal')


if __name__=='__main__':unittest.main()
