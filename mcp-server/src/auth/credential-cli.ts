import { emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { KeyringSecretStore } from './secret-store.js';

const usage = '用法：npm run credential -- <set|status|remove>';

const readHidden = async (prompt: string): Promise<string> => {
  if (!stdin.isTTY) throw new Error('凭证操作只能在交互式终端中执行。');
  stdout.write(prompt);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  return new Promise((resolve) => {
    let value = '';
    const onKeypress = (chunk: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.name === 'return' || key.name === 'enter') {
        stdin.off('keypress', onKeypress);
        stdin.setRawMode(false);
        stdout.write('\n');
        resolve(value);
      } else if (key.name === 'backspace') {
        value = value.slice(0, -1);
      } else if (!key.ctrl && chunk) {
        value += chunk;
      }
    };
    stdin.on('keypress', onKeypress);
  });
};

const main = async (): Promise<void> => {
  const action = process.argv[2];
  if (!stdin.isTTY || !stdout.isTTY) throw new Error('凭证操作只能在交互式终端中执行。');
  const store = new KeyringSecretStore();
  if (action === 'status') {
    stdout.write(store.get() ? '已配置访问凭证。\n' : '尚未配置访问凭证。\n');
    return;
  }
  if (action === 'remove') {
    store.remove();
    stdout.write('已移除本机访问凭证。\n');
    return;
  }
  if (action === 'set') {
    const token = await readHidden('请输入墨墨只读访问凭证：');
    store.set(token);
    stdout.write('访问凭证已保存到操作系统安全凭证存储。\n');
    return;
  }
  throw new Error(usage);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '凭证操作失败。'}\n`);
  process.exitCode = 1;
});
