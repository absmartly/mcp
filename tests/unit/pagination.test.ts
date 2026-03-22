import { API_CATALOG, getMethodEntry } from '../../src/api-catalog';
import type { ApiMethodEntry } from '../../src/api-catalog';

const DEFAULT_LIST_ITEMS = 20;

function isListOrSearchMethod(methodName: string): boolean {
    return methodName.startsWith('list') || methodName.startsWith('search');
}

function applyLimitToParams(
    entry: ApiMethodEntry,
    methodParams: Record<string, unknown>,
    userLimit: number | undefined
): Record<string, unknown> {
    const params = { ...methodParams };
    const itemsLimit = userLimit ?? DEFAULT_LIST_ITEMS;
    const methodName = entry.method;

    if (isListOrSearchMethod(methodName)) {
        if (entry.params.some(ep => ep.name === 'options')) {
            if (!params.options) params.options = {};
            if (typeof params.options === 'object' && !(params.options as any).items) {
                (params.options as any).items = itemsLimit;
            }
        }
        if (entry.params.some(ep => ep.name === 'limit') && params.limit === undefined) {
            params.limit = itemsLimit;
        }
        if (entry.params.some(ep => ep.name === 'items') && params.items === undefined) {
            params.items = itemsLimit;
        }
    }

    return params;
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

    assert(
        DEFAULT_LIST_ITEMS === 20,
        'DEFAULT_LIST_ITEMS is 20',
        `Got ${DEFAULT_LIST_ITEMS}`
    );

    const listExpEntry = getMethodEntry('listExperiments');
    assert(listExpEntry !== undefined, 'listExperiments exists in catalog');

    if (listExpEntry) {
        const result = applyLimitToParams(listExpEntry, {}, undefined);
        assert(
            (result.options as any)?.items === DEFAULT_LIST_ITEMS,
            'listExperiments gets default items in options',
            `Got: ${JSON.stringify(result.options)}`
        );
    }

    if (listExpEntry) {
        const result = applyLimitToParams(listExpEntry, { options: { items: 50, sort: 'name' } }, undefined);
        assert(
            (result.options as any).items === 50,
            'existing options.items is NOT overridden',
            `Got: ${(result.options as any).items}`
        );
        assert(
            (result.options as any).sort === 'name',
            'existing options.sort is preserved',
            `Got: ${(result.options as any).sort}`
        );
    }

    if (listExpEntry) {
        const result = applyLimitToParams(listExpEntry, {}, 10);
        assert(
            (result.options as any)?.items === 10,
            'user-provided limit overrides default',
            `Got: ${(result.options as any)?.items}`
        );
    }

    const getExpEntry = getMethodEntry('getExperiment');
    assert(getExpEntry !== undefined, 'getExperiment exists in catalog');

    if (getExpEntry) {
        const result = applyLimitToParams(getExpEntry, { id: 42 }, undefined);
        assert(
            result.options === undefined,
            'getExperiment does not get options injected',
            `Got: ${JSON.stringify(result.options)}`
        );
        assert(
            result.items === undefined,
            'getExperiment does not get items injected',
            `Got: ${JSON.stringify(result.items)}`
        );
        assert(
            result.limit === undefined,
            'getExperiment does not get limit injected',
            `Got: ${JSON.stringify(result.limit)}`
        );
    }

    const listMethodsWithOptions = API_CATALOG.filter(
        e => isListOrSearchMethod(e.method) && e.params.some(p => p.name === 'options')
    );
    for (const entry of listMethodsWithOptions) {
        const result = applyLimitToParams(entry, {}, undefined);
        assert(
            (result.options as any)?.items === DEFAULT_LIST_ITEMS,
            `${entry.method} gets default items in options`,
            `Got: ${JSON.stringify(result.options)}`
        );
    }

    const listMethodsWithLimit = API_CATALOG.filter(
        e => isListOrSearchMethod(e.method) && e.params.some(p => p.name === 'limit')
    );
    for (const entry of listMethodsWithLimit) {
        const result = applyLimitToParams(entry, {}, undefined);
        assert(
            result.limit === DEFAULT_LIST_ITEMS,
            `${entry.method} gets default limit param`,
            `Got: ${JSON.stringify(result.limit)}`
        );
    }

    const listMethodsWithItems = API_CATALOG.filter(
        e => isListOrSearchMethod(e.method) && e.params.some(p => p.name === 'items')
    );
    for (const entry of listMethodsWithItems) {
        const result = applyLimitToParams(entry, {}, undefined);
        assert(
            result.items === DEFAULT_LIST_ITEMS,
            `${entry.method} gets default items param`,
            `Got: ${JSON.stringify(result.items)}`
        );
    }

    for (const entry of listMethodsWithLimit) {
        const result = applyLimitToParams(entry, { limit: 5 }, undefined);
        assert(
            result.limit === 5,
            `${entry.method} preserves user-provided limit`,
            `Got: ${result.limit}`
        );
    }

    for (const entry of listMethodsWithItems) {
        const result = applyLimitToParams(entry, { items: 5 }, undefined);
        assert(
            result.items === 5,
            `${entry.method} preserves user-provided items`,
            `Got: ${result.items}`
        );
    }

    const searchExpEntry = getMethodEntry('searchExperiments');
    if (searchExpEntry) {
        const result = applyLimitToParams(searchExpEntry, {}, undefined);
        const hasOptionsOrItems = (result.options as any)?.items === DEFAULT_LIST_ITEMS ||
            result.items === DEFAULT_LIST_ITEMS ||
            result.limit === DEFAULT_LIST_ITEMS;
        assert(
            hasOptionsOrItems,
            'searchExperiments gets default pagination',
            `Got: ${JSON.stringify(result)}`
        );
    }

    const nonListMethods = API_CATALOG.filter(e => !isListOrSearchMethod(e.method)).slice(0, 10);
    for (const entry of nonListMethods) {
        const result = applyLimitToParams(entry, {}, undefined);
        const hasInjectedPagination = (result.options as any)?.items === DEFAULT_LIST_ITEMS ||
            result.items === DEFAULT_LIST_ITEMS ||
            result.limit === DEFAULT_LIST_ITEMS;
        assert(
            !hasInjectedPagination,
            `${entry.method} does not get pagination injected`,
            `Got unexpected pagination in: ${JSON.stringify(result)}`
        );
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
