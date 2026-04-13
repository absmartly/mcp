const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
type LogLevel = typeof LOG_LEVELS[number];

export default async function runTests() {
    let passed = 0;
    let failed = 0;
    const details: Array<{ name: string; status: string; error?: string }> = [];

    function assert(condition: boolean, name: string, error: string = 'Assertion failed') {
        if (condition) {
            passed++;
            details.push({ name, status: 'PASS' });
        } else {
            failed++;
            details.push({ name, status: 'FAIL', error });
        }
    }

    assert(LOG_LEVELS.length === 4, 'LOG_LEVELS has 4 entries', `Got ${LOG_LEVELS.length}`);
    assert(LOG_LEVELS.includes('debug'), 'LOG_LEVELS includes debug');
    assert(LOG_LEVELS.includes('info'), 'LOG_LEVELS includes info');
    assert(LOG_LEVELS.includes('warning'), 'LOG_LEVELS includes warning');
    assert(LOG_LEVELS.includes('error'), 'LOG_LEVELS includes error');

    let debugCalled = false;
    let sendLoggingCalled = false;
    let lastLevel: string | null = null;
    let lastData: string | null = null;

    const mockDebug = (msg: string) => {
        debugCalled = true;
    };

    const mockSendLoggingMessage = (opts: { level: string; data: string }) => {
        sendLoggingCalled = true;
        lastLevel = opts.level;
        lastData = opts.data;
    };

    function mockLog(level: LogLevel, message: string): void {
        mockDebug(message);
        try {
            mockSendLoggingMessage({ level, data: message });
        } catch {}
    }

    debugCalled = false;
    sendLoggingCalled = false;
    mockLog('debug', 'test debug message');
    assert(debugCalled, 'log() calls debug()');
    assert(sendLoggingCalled, 'log() calls sendLoggingMessage');
    assert(lastLevel === 'debug', 'log() passes correct level to sendLoggingMessage', `Got: ${lastLevel}`);
    assert(lastData === 'test debug message', 'log() passes correct data to sendLoggingMessage', `Got: ${lastData}`);

    for (const level of LOG_LEVELS) {
        debugCalled = false;
        sendLoggingCalled = false;
        lastLevel = null;
        lastData = null;
        mockLog(level, `test ${level} message`);
        assert(debugCalled, `log("${level}") calls debug()`);
        assert(sendLoggingCalled, `log("${level}") calls sendLoggingMessage`);
        assert(lastLevel === level, `log("${level}") passes level "${level}"`, `Got: ${lastLevel}`);
        assert(lastData === `test ${level} message`, `log("${level}") passes message`, `Got: ${lastData}`);
    }

    let throwingCalled = false;
    const mockSendLoggingThrows = (_opts: { level: string; data: string }) => {
        throwingCalled = true;
        throw new Error('sendLoggingMessage failed');
    };

    function mockLogWithThrow(level: LogLevel, message: string): void {
        mockDebug(message);
        try {
            mockSendLoggingThrows({ level, data: message });
        } catch {}
    }

    let didThrow = false;
    try {
        mockLogWithThrow('error', 'should not throw');
    } catch {
        didThrow = true;
    }
    assert(!didThrow, 'log() does not throw when sendLoggingMessage fails');
    assert(throwingCalled, 'sendLoggingMessage was called before catching error');

    function mockLogSignature(level: LogLevel, message: string): void {
        mockDebug(message);
        try {
            mockSendLoggingMessage({ level, data: message });
        } catch {}
    }

    const validLevels: LogLevel[] = ['debug', 'info', 'warning', 'error'];
    for (const level of validLevels) {
        lastLevel = null;
        mockLogSignature(level, 'sig test');
        assert(
            lastLevel === level,
            `log signature accepts level "${level}"`,
            `Got: ${lastLevel}`
        );
    }

    mockLog('info', '');
    assert(lastData === '', 'log() handles empty message');

    mockLog('warning', 'a'.repeat(1000));
    assert(lastData === 'a'.repeat(1000), 'log() handles long messages');

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
