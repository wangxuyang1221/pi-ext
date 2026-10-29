"""Observe static tool cells independently from the task animation."""
import unittest
import pyte
from held_frame import held_frame


class HeldFrameTest(unittest.TestCase):
    def setUp(self):
        self.screen = pyte.Screen(80, 12)
        self.stream = pyte.Stream(self.screen)
        self.stream.feed('Fixture: all / hold\r\n\x1b[38;2;255;230;109m$ Bash(command)\x1b[0m\r\n  Running…\r\n\x1b[38;2;94;252;255m ⠋ \x1b[38;2;128;128;128mWorking (1s)\x1b[0m\r\n> draft\r\n≈10 t/s')

    def test_animation_and_footer_changes_leave_tool_cells_identical(self):
        before = held_frame(self.screen, 'Fixture: all / hold')
        self.assertEqual(before[1], ('⠋', ('808080',) * 7, '5efcff'))
        self.assertEqual([row for row, _cells in before[0]], [0, 1, 2])
        self.stream.feed('\x1b[4;2H⠙\x1b[4;4H\x1b[38;2;200;200;200mWorking\x1b[6;1H≈20 t/s')
        after = held_frame(self.screen, 'Fixture: all / hold')
        self.assertEqual(before[0], after[0])
        self.assertNotEqual(before[1][0], after[1][0])
        self.assertNotEqual(before[1][1], after[1][1])
        self.assertEqual(before[1][2], '5efcff')

    def test_tool_text_color_and_position_changes_are_observable(self):
        before = held_frame(self.screen, 'Fixture: all / hold')[0]
        for sequence in ['\x1b[2;1HX', '\x1b[2;1H\x1b[31m$', '\x1b[2;1H\x1b[7m$', '\x1b[3;1H\x1b[L']:
            with self.subTest(sequence=sequence):
                self.setUp()
                self.stream.feed(sequence)
                self.assertNotEqual(before, held_frame(self.screen, 'Fixture: all / hold')[0])

    def test_missing_or_reordered_boundaries_fail(self):
        with self.assertRaises(AssertionError):
            held_frame(self.screen, 'missing heading')
        self.stream.feed('\x1b[4;1H\x1b[2K')
        with self.assertRaises(AssertionError):
            held_frame(self.screen, 'Fixture: all / hold')

    def test_only_latest_held_region_is_selected(self):
        self.stream.feed('\x1b[8;1HFixture: all / hold\r\n$ Bash(latest)\r\n ⠹ Working (2s)')
        cards, animation = held_frame(self.screen, 'Fixture: all / hold')
        self.assertEqual([row for row, _cells in cards], [7, 8])
        self.assertEqual(animation[0], '⠹')

    def test_heading_cannot_share_or_follow_the_working_row(self):
        for row in [4, 5]:
            with self.subTest(row=row):
                self.setUp()
                self.stream.feed(f'\x1b[{row};25HFixture: all / hold')
                with self.assertRaises(AssertionError):
                    held_frame(self.screen, 'Fixture: all / hold')


if __name__ == '__main__':
    unittest.main()
