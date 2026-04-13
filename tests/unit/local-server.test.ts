const CONFIG_FILE_PATH = '.config/absmartly/config.yaml';
const DEFAULT_PROFILE_NAME = 'default';
const KEYCHAIN_SERVICE_PREFIX = 'absmartly-cli-';

function parseYamlConfig(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const match = line.match(/^(\S[^:]*?):\s*(.+)$/);
        if (match) {
            result[match[1].trim()] = match[2].trim();
        }
    }
    return result;
}

function resolveProfile(config: Record<string, string>, profileName: string): string {
    return profileName === DEFAULT_PROFILE_NAME && config['default-profile']
        ? config['default-profile']
        : profileName;
}

function getEndpoint(config: Record<string, string>, resolvedProfile: string): string | undefined {
    return config[`profiles.${resolvedProfile}.endpoint`]
        || config[`profiles.${resolvedProfile}.url`];
}

function buildKeychainArgs(resolvedProfile: string): string[] {
    return [
        'find-generic-password',
        '-s', `${KEYCHAIN_SERVICE_PREFIX}${resolvedProfile}`,
        '-w',
    ];
}

function parseProfileArg(argv: string[]): string {
    const profileArg = argv.find(a => a.startsWith('--profile='));
    return profileArg ? profileArg.split('=')[1] : DEFAULT_PROFILE_NAME;
}

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

    {
        const yaml = `default-profile: prod
profiles.prod.endpoint: https://prod.absmartly.com/v1
profiles.prod.url: https://prod-old.absmartly.com/v1
profiles.staging.endpoint: https://staging.absmartly.com/v1`;
        const config = parseYamlConfig(yaml);
        assert(config['default-profile'] === 'prod', 'parses default-profile');
        assert(config['profiles.prod.endpoint'] === 'https://prod.absmartly.com/v1', 'parses prod endpoint');
        assert(config['profiles.prod.url'] === 'https://prod-old.absmartly.com/v1', 'parses prod url');
        assert(config['profiles.staging.endpoint'] === 'https://staging.absmartly.com/v1', 'parses staging endpoint');
    }

    {
        const config = parseYamlConfig('');
        assert(Object.keys(config).length === 0, 'empty string produces empty config');
    }

    {
        const yaml = `# comment line
  indented-line: should-be-skipped
valid-key: valid-value`;
        const config = parseYamlConfig(yaml);
        assert(config['valid-key'] === 'valid-value', 'parses valid key');
        assert(config['# comment line'] === undefined, 'skips comment-like lines without value');
        assert(config['  indented-line'] === undefined, 'skips indented lines');
    }

    {
        const yaml = 'key: value with spaces and: colons';
        const config = parseYamlConfig(yaml);
        assert(config['key'] === 'value with spaces and: colons', 'value can contain colons');
    }

    {
        const config = { 'default-profile': 'prod' };
        const resolved = resolveProfile(config, DEFAULT_PROFILE_NAME);
        assert(resolved === 'prod', 'default profile resolves to configured default-profile');
    }

    {
        const config = { 'default-profile': 'prod' };
        const resolved = resolveProfile(config, 'staging');
        assert(resolved === 'staging', 'explicit profile name is used as-is');
    }

    {
        const config: Record<string, string> = {};
        const resolved = resolveProfile(config, DEFAULT_PROFILE_NAME);
        assert(resolved === DEFAULT_PROFILE_NAME, 'falls back to default when no default-profile configured');
    }

    {
        const config = {
            'profiles.prod.endpoint': 'https://prod.absmartly.com/v1',
            'profiles.prod.url': 'https://prod-old.absmartly.com/v1',
        };
        const endpoint = getEndpoint(config, 'prod');
        assert(endpoint === 'https://prod.absmartly.com/v1', 'endpoint takes precedence over url');
    }

    {
        const config = {
            'profiles.staging.url': 'https://staging.absmartly.com/v1',
        };
        const endpoint = getEndpoint(config, 'staging');
        assert(endpoint === 'https://staging.absmartly.com/v1', 'falls back to url when no endpoint');
    }

    {
        const config: Record<string, string> = {};
        const endpoint = getEndpoint(config, 'nonexistent');
        assert(endpoint === undefined, 'returns undefined for missing profile');
    }

    {
        const args = buildKeychainArgs('prod');
        assert(args[0] === 'find-generic-password', 'keychain command is find-generic-password');
        assert(args[1] === '-s', 'keychain has -s flag');
        assert(args[2] === 'absmartly-cli-prod', 'keychain service is absmartly-cli-{profile}');
        assert(args[3] === '-w', 'keychain has -w flag');
        assert(args.length === 4, 'keychain args has 4 elements', `Got ${args.length}`);
    }

    {
        const args = buildKeychainArgs('my-custom-profile');
        assert(args[2] === 'absmartly-cli-my-custom-profile', 'keychain uses custom profile name');
    }

    {
        const profile = parseProfileArg(['node', 'script.js', '--profile=test-1']);
        assert(profile === 'test-1', 'parses --profile=test-1');
    }

    {
        const profile = parseProfileArg(['node', 'script.js', '--profile=production']);
        assert(profile === 'production', 'parses --profile=production');
    }

    {
        const profile = parseProfileArg(['node', 'script.js']);
        assert(profile === DEFAULT_PROFILE_NAME, 'defaults to default profile when no --profile flag');
    }

    {
        const profile = parseProfileArg(['node', 'script.js', '--other-flag', '--profile=staging', '--verbose']);
        assert(profile === 'staging', 'finds --profile among other flags');
    }

    assert(CONFIG_FILE_PATH === '.config/absmartly/config.yaml', 'CONFIG_FILE_PATH has correct value');
    assert(DEFAULT_PROFILE_NAME === 'default', 'DEFAULT_PROFILE_NAME is "default"');
    assert(KEYCHAIN_SERVICE_PREFIX === 'absmartly-cli-', 'KEYCHAIN_SERVICE_PREFIX is "absmartly-cli-"');

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
