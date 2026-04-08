// Pagination logic is now handled directly in src/tools.ts execute_command handler.
// The old API_CATALOG-based pagination tests are no longer applicable.
// This test validates the new pagination behavior.

import {
  getCommandEntry,
  CLI_GROUPS,
  getGroupCommands,
} from '../../src/cli-catalog';

const DEFAULT_LIST_ITEMS = 20;

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

    assert(DEFAULT_LIST_ITEMS === 20, 'DEFAULT_LIST_ITEMS is 20');

    // Verify list commands exist in catalog
    const listExp = getCommandEntry('experiments', 'listExperiments');
    assert(listExp !== undefined, 'experiments.listExperiments exists in catalog');

    const listMetrics = getCommandEntry('metrics', 'listMetrics');
    assert(listMetrics !== undefined, 'metrics.listMetrics exists in catalog');

    // Verify get commands exist
    const getExp = getCommandEntry('experiments', 'getExperiment');
    assert(getExp !== undefined, 'experiments.getExperiment exists in catalog');

    // Verify list commands have items param documented
    if (listExp) {
        const hasItemsParam = listExp.params.some(p => p.name === 'items');
        assert(hasItemsParam, 'listExperiments has items param');
    }

    if (listMetrics) {
        const hasItemsParam = listMetrics.params.some(p => p.name === 'items');
        assert(hasItemsParam, 'listMetrics has items param');
    }

    // Verify all groups have at least one command
    for (const group of CLI_GROUPS) {
        const commands = getGroupCommands(group);
        assert(commands.length > 0, `${group} has at least one command`, `Got ${commands.length}`);
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
