import {
    CLI_GROUPS,
    searchCommands,
    getGroupCommands,
} from '../../src/cli-catalog';

const MAX_COMPLETIONS = 20;

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

    // Group completion
    const groupCompletion = (value: string) => {
        const lower = (value || '').toLowerCase();
        return CLI_GROUPS
            .filter(g => g.toLowerCase().startsWith(lower))
            .slice(0, MAX_COMPLETIONS);
    };

    const emptyGroups = groupCompletion('');
    assert(
        emptyGroups.length === Math.min(CLI_GROUPS.length, MAX_COMPLETIONS),
        'empty string returns all groups (up to max)',
        `Expected ${Math.min(CLI_GROUPS.length, MAX_COMPLETIONS)}, got ${emptyGroups.length}`
    );

    const expGroups = groupCompletion('exp');
    assert(expGroups.length > 0, 'partial "exp" returns results');
    for (const g of expGroups) {
        assert(
            g.toLowerCase().startsWith('exp'),
            `group "${g}" starts with "exp"`,
        );
    }

    const noMatchGroups = groupCompletion('zzzznonexistent');
    assert(noMatchGroups.length === 0, 'non-matching group string returns empty');

    // Command search
    const searchResults = searchCommands('list');
    assert(searchResults.length > 0, '"list" search returns results');
    for (const r of searchResults.slice(0, 5)) {
        assert(
            r.command.toLowerCase().includes('list') || r.description.toLowerCase().includes('list'),
            `search result "${r.group}.${r.command}" matches "list"`,
        );
    }

    const noMatchSearch = searchCommands('zzzznonexistent');
    assert(noMatchSearch.length === 0, 'non-matching search returns empty');

    // Case insensitive search
    const lowerResults = searchCommands('create');
    const upperResults = searchCommands('CREATE');
    assert(
        lowerResults.length === upperResults.length,
        'search is case-insensitive',
        `Lower: ${lowerResults.length}, upper: ${upperResults.length}`
    );

    // Group commands
    const expCommands = getGroupCommands('experiments');
    assert(expCommands.length > 0, 'experiments group has commands');

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
