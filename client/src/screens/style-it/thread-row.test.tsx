import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { THREAD_INDENT, ThreadRow, threadPath } from './thread-row';

describe('threadPath', () => {
  test('a branch runs on down the row unless it is the last', () => {
    expect(threadPath('branch', false, 300).d).toContain('V300');
    expect(threadPath('branch', true, 300).d).not.toContain('V300');
    expect(threadPath('branch', false, 300).length).toBeGreaterThan(300);
  });

  test('the root ties the piece to the thread, then runs down', () => {
    const { d } = threadPath('root', false, 240);
    expect(d.startsWith(`M${THREAD_INDENT - 6} `)).toBe(true);
    expect(d.endsWith('V240')).toBe(true);
  });
});

test('ThreadRow shows its content', async () => {
  await render(
    <ThreadRow kind="branch">
      <Text>An outfit</Text>
    </ThreadRow>,
  );
  expect(screen.getByText('An outfit')).toBeOnTheScreen();
});
