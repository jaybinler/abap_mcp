import { Console } from 'console';
import { BaseHandler } from '../../handlers/BaseHandler';
import { createLogger } from '../../lib/logger';
class Handler extends BaseHandler {
  getTools() { return []; }
  async handle() { return {}; }
  run(fn: () => Promise<unknown>) { return this.withSession(fn); }
}
describe('stdio and recovery regressions', () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  test('all logs use stderr', () => {
    const out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const originalConsole = global.console;
    global.console = new Console(process.stdout, process.stderr);
    const log = createLogger('test');
    log.info('i'); log.debug('d'); log.warn('w'); log.error('e');
    global.console = originalConsole;
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(4);
  });
  const expired = Object.assign(new Error('Session expired'), { err: 401 });
  test.each(['ordinary', 'recovered', 'business', 'expired', 'loginRetry', 'loginFailure'])('%s', async mode => {
    jest.useFakeTimers();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const client = { login: jest.fn().mockResolvedValue(undefined), dropSession: jest.fn().mockResolvedValue(undefined) };
    const handler = new Handler(client as any);
    const error = new Error('write rejected');
    const fn = jest.fn();
    if (mode === 'ordinary') fn.mockRejectedValue(error);
    else {
      fn.mockRejectedValueOnce(expired);
      if (mode === 'business') fn.mockRejectedValue(error);
      else if (mode === 'expired') fn.mockRejectedValue(expired);
      else fn.mockResolvedValue('ok');
    }
    if (mode === 'loginRetry') client.login.mockRejectedValueOnce(new Error('offline'));
    if (mode === 'loginFailure') client.login.mockRejectedValue(new Error('offline'));
    const result = handler.run(fn);
    const check = mode === 'ordinary' || mode === 'business' ? expect(result).rejects.toBe(error)
      : mode === 'expired' ? expect(result).rejects.toBe(expired)
      : mode === 'loginFailure' ? expect(result).rejects.toThrow('re-login failed: offline')
      : expect(result).resolves.toBe('ok');
    await jest.runAllTimersAsync();
    await check;
    expect(fn).toHaveBeenCalledTimes(['ordinary','loginFailure'].includes(mode) ? 1 : 2);
    expect(client.login).toHaveBeenCalledTimes(mode === 'ordinary' ? 0 : mode.startsWith('login') ? 2 : 1);
  });
});
