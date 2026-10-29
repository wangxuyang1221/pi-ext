"""Capture held tool cells and the independently animated Working indicator."""
import re


def held_frame(screen, heading):
    lines = screen.display
    headers = [row for row, line in enumerate(lines) if heading in line]
    working = [(row, match) for row, line in enumerate(lines)
               if (match := re.search(r'([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]) Working \(', line))]
    assert headers and working, 'Held tools and Working must both be visible'
    start = headers[-1]
    end, match = working[-1]
    assert start < end, 'Working must follow the held tool cards'
    cards = tuple((row, tuple(screen.buffer[row][col] for col in range(screen.columns)))
                  for row in range(start, end))
    col = match.start()
    animation = (match[1], tuple(screen.buffer[end][x].fg for x in range(col + 2, col + 9)),
                 screen.buffer[end][col].fg)
    return cards, animation
