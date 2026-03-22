import {
    API_CATALOG,
    API_CATEGORIES,
    searchCatalog,
} from '../../src/api-catalog';

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

    const categoryCompletion = (value: string) => {
        const lower = (value || '').toLowerCase();
        return API_CATEGORIES
            .filter(c => c.toLowerCase().startsWith(lower))
            .slice(0, MAX_COMPLETIONS);
    };

    const emptyCategories = categoryCompletion('');
    assert(
        emptyCategories.length === Math.min(API_CATEGORIES.length, MAX_COMPLETIONS),
        'empty string returns all categories (up to max)',
        `Expected ${Math.min(API_CATEGORIES.length, MAX_COMPLETIONS)}, got ${emptyCategories.length}`
    );

    const expCategories = categoryCompletion('exp');
    assert(expCategories.length > 0, 'partial "exp" returns results');
    for (const cat of expCategories) {
        assert(
            cat.toLowerCase().startsWith('exp'),
            `category "${cat}" starts with "exp"`,
            `"${cat}" does not start with "exp"`
        );
    }

    const upperCategories = categoryCompletion('EXP');
    assert(
        upperCategories.length === expCategories.length,
        'category completion is case-insensitive',
        `Upper: ${upperCategories.length}, lower: ${expCategories.length}`
    );

    const noMatchCategories = categoryCompletion('zzzznonexistent');
    assert(noMatchCategories.length === 0, 'non-matching category string returns empty');

    const methodCompletion = (value: string) => {
        const lower = (value || '').toLowerCase();
        return API_CATALOG
            .filter(m => m.method.toLowerCase().includes(lower))
            .map(m => m.method)
            .slice(0, MAX_COMPLETIONS);
    };

    const emptyMethods = methodCompletion('');
    assert(
        emptyMethods.length === MAX_COMPLETIONS,
        'empty string returns MAX_COMPLETIONS methods',
        `Expected ${MAX_COMPLETIONS}, got ${emptyMethods.length}`
    );

    const listMethods = methodCompletion('list');
    assert(listMethods.length > 0, '"list" returns results');
    for (const m of listMethods) {
        assert(
            m.toLowerCase().includes('list'),
            `method "${m}" contains "list"`,
            `"${m}" does not contain "list"`
        );
    }

    const experimentMethods = methodCompletion('Experiment');
    assert(experimentMethods.length > 0, '"Experiment" returns results');
    for (const m of experimentMethods) {
        assert(
            m.toLowerCase().includes('experiment'),
            `method "${m}" contains "experiment"`,
            `"${m}" does not contain "experiment"`
        );
    }

    const noMatchMethods = methodCompletion('zzzznonexistent');
    assert(noMatchMethods.length === 0, 'non-matching method string returns empty');

    const allMatchingMethods = API_CATALOG
        .filter(m => m.method.toLowerCase().includes('e'))
        .map(m => m.method);
    const cappedMethods = methodCompletion('e');
    assert(
        cappedMethods.length <= MAX_COMPLETIONS,
        'method completion respects MAX_COMPLETIONS limit',
        `Got ${cappedMethods.length}, max is ${MAX_COMPLETIONS}`
    );
    if (allMatchingMethods.length > MAX_COMPLETIONS) {
        assert(
            cappedMethods.length === MAX_COMPLETIONS,
            'method completion returns exactly MAX_COMPLETIONS when more matches exist',
            `Expected ${MAX_COMPLETIONS}, got ${cappedMethods.length}`
        );
    }

    const cappedCategories = categoryCompletion('');
    assert(
        cappedCategories.length <= MAX_COMPLETIONS,
        'category completion respects MAX_COMPLETIONS limit',
        `Got ${cappedCategories.length}, max is ${MAX_COMPLETIONS}`
    );

    const createMethods = methodCompletion('create');
    const createMethodsUpper = methodCompletion('CREATE');
    assert(
        createMethods.length === createMethodsUpper.length,
        'method completion is case-insensitive',
        `Lower: ${createMethods.length}, upper: ${createMethodsUpper.length}`
    );

    const singleCharMethods = methodCompletion('g');
    assert(
        singleCharMethods.length > 0,
        'single char "g" returns methods',
        `Got ${singleCharMethods.length}`
    );
    for (const m of singleCharMethods) {
        assert(
            m.toLowerCase().includes('g'),
            `method "${m}" contains "g"`,
            `"${m}" does not contain "g"`
        );
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
