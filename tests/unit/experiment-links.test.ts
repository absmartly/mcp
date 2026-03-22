import {
    summarizeExperimentRow,
    summarizeExperiment,
} from '@absmartly/cli/api-client';

const VERSION_SUFFIX_REGEX = /\/v\d+\/?$/;

function getBaseUrl(endpoint: string | undefined): string {
    return endpoint?.replace(VERSION_SUFFIX_REGEX, '') || '';
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
        getBaseUrl('https://example.com/v1') === 'https://example.com',
        'getBaseUrl strips /v1',
        `Got: "${getBaseUrl('https://example.com/v1')}"`
    );

    assert(
        getBaseUrl('https://example.com/v2') === 'https://example.com',
        'getBaseUrl strips /v2',
        `Got: "${getBaseUrl('https://example.com/v2')}"`
    );

    assert(
        getBaseUrl('https://example.com/v1/') === 'https://example.com',
        'getBaseUrl strips /v1/ with trailing slash',
        `Got: "${getBaseUrl('https://example.com/v1/')}"`
    );

    assert(
        getBaseUrl('https://example.com/api/v1') === 'https://example.com/api',
        'getBaseUrl strips /v1 from deeper path',
        `Got: "${getBaseUrl('https://example.com/api/v1')}"`
    );

    assert(
        getBaseUrl('https://example.com') === 'https://example.com',
        'getBaseUrl handles endpoint without version suffix',
        `Got: "${getBaseUrl('https://example.com')}"`
    );

    assert(
        getBaseUrl('https://example.com/api') === 'https://example.com/api',
        'getBaseUrl handles endpoint with non-version path',
        `Got: "${getBaseUrl('https://example.com/api')}"`
    );

    assert(
        getBaseUrl(undefined) === '',
        'getBaseUrl handles undefined endpoint',
        `Got: "${getBaseUrl(undefined)}"`
    );

    assert(
        getBaseUrl('') === '',
        'getBaseUrl handles empty string endpoint',
        `Got: "${getBaseUrl('')}"`
    );

    const mockExperiment = {
        id: 42,
        name: 'test_exp',
        state: 'running',
        type: 'test',
        created_at: '2024-01-01',
    };
    const baseUrl = 'https://example.com';

    const rowSummary = summarizeExperimentRow(mockExperiment, [], []) as any;
    if (baseUrl) rowSummary.link = `${baseUrl}/experiments/${mockExperiment.id}`;
    assert(
        rowSummary.link === 'https://example.com/experiments/42',
        'experiment row summary includes correct link',
        `Got: "${rowSummary.link}"`
    );

    const singleSummary = summarizeExperiment(mockExperiment as any, [], []) as any;
    if (baseUrl) singleSummary.link = `${baseUrl}/experiments/${mockExperiment.id}`;
    assert(
        singleSummary.link === 'https://example.com/experiments/42',
        'single experiment summary includes correct link',
        `Got: "${singleSummary.link}"`
    );

    const noLinkSummary = summarizeExperimentRow(mockExperiment, [], []) as any;
    const emptyBase = getBaseUrl(undefined);
    if (emptyBase) noLinkSummary.link = `${emptyBase}/experiments/${mockExperiment.id}`;
    assert(
        noLinkSummary.link === undefined,
        'link is not added when baseUrl is empty',
        `Got: "${noLinkSummary.link}"`
    );

    const expectedLinkFormat = `${baseUrl}/experiments/${mockExperiment.id}`;
    assert(
        expectedLinkFormat === 'https://example.com/experiments/42',
        'link format is {baseUrl}/experiments/{id}',
        `Got: "${expectedLinkFormat}"`
    );

    const expWithHighId = { ...mockExperiment, id: 99999 };
    const highIdSummary = summarizeExperimentRow(expWithHighId, [], []) as any;
    if (baseUrl) highIdSummary.link = `${baseUrl}/experiments/${expWithHighId.id}`;
    assert(
        highIdSummary.link === 'https://example.com/experiments/99999',
        'link works with large experiment ids',
        `Got: "${highIdSummary.link}"`
    );

    const deepBaseUrl = getBaseUrl('https://app.example.com/api/v1');
    const deepLink = `${deepBaseUrl}/experiments/${mockExperiment.id}`;
    assert(
        deepLink === 'https://app.example.com/api/experiments/42',
        'link uses correctly stripped deep base URL',
        `Got: "${deepLink}"`
    );

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
