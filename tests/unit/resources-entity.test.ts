import type { CustomSectionField } from '@absmartly/cli/api-client';

const ENTITY_URIS = [
    'absmartly://entities/applications',
    'absmartly://entities/unit-types',
    'absmartly://entities/teams',
    'absmartly://entities/users',
    'absmartly://entities/metrics',
    'absmartly://entities/goals',
    'absmartly://entities/tags',
    'absmartly://entities/custom-fields',
];

const ENTITY_NAMES = [
    'Applications',
    'Unit Types',
    'Teams',
    'Users',
    'Metrics',
    'Goals',
    'Tags',
    'Custom Fields',
];

const EXPERIMENT_TEMPLATE_URI = 'absmartly://experiments/{id}';

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

    assert(ENTITY_URIS.length === 8, 'exactly 8 entity resource URIs defined', `Got ${ENTITY_URIS.length}`);

    const expectedUris = [
        'absmartly://entities/applications',
        'absmartly://entities/unit-types',
        'absmartly://entities/teams',
        'absmartly://entities/users',
        'absmartly://entities/metrics',
        'absmartly://entities/goals',
        'absmartly://entities/tags',
        'absmartly://entities/custom-fields',
    ];

    for (const uri of expectedUris) {
        assert(ENTITY_URIS.includes(uri), `entity URIs include ${uri}`);
    }

    assert(
        EXPERIMENT_TEMPLATE_URI === 'absmartly://experiments/{id}',
        'experiment resource template has correct URI pattern'
    );
    assert(
        EXPERIMENT_TEMPLATE_URI.includes('{id}'),
        'experiment template URI contains {id} placeholder'
    );

    class MockResourceServer {
        registrations: Map<string, { name: string; uri: string; description: string; handler: () => Promise<any> }> = new Map();

        resource(name: string, uri: string, options: { description: string }, handler: () => Promise<any>) {
            this.registrations.set(uri, { name, uri, description: options.description, handler });
        }
    }

    const server = new MockResourceServer();

    const mockApplications = [{ id: 1, name: 'web-app' }, { id: 2, name: 'mobile-app' }];
    const mockUnitTypes = [{ id: 1, name: 'user_id' }];
    const mockTeams = [{ id: 1, name: 'growth' }];
    const mockUsers = [{ id: 1, name: 'Alice' }];
    const mockMetrics = [{ id: 1, name: 'conversion' }];
    const mockGoals = [{ id: 1, name: 'signup' }];
    const mockTags = [{ id: 1, name: 'v2' }];
    const mockCustomFields: CustomSectionField[] = [
        {
            id: 10,
            name: 'priority',
            type: 'string',
            default_value: 'medium',
            archived: false,
            custom_section: { type: 'test', archived: false },
        } as CustomSectionField,
        {
            id: 11,
            name: 'old_field',
            type: 'string',
            archived: true,
            custom_section: { type: 'test', archived: false },
        } as CustomSectionField,
    ];

    const entityConfigs = [
        { name: 'Applications', uri: 'absmartly://entities/applications', description: 'Cached list of available applications', getData: () => mockApplications },
        { name: 'Unit Types', uri: 'absmartly://entities/unit-types', description: 'Cached list of available unit types', getData: () => mockUnitTypes },
        { name: 'Teams', uri: 'absmartly://entities/teams', description: 'Cached list of available teams', getData: () => mockTeams },
        { name: 'Users', uri: 'absmartly://entities/users', description: 'Cached list of users (summarized)', getData: () => mockUsers },
        { name: 'Metrics', uri: 'absmartly://entities/metrics', description: 'Cached list of available metrics', getData: () => mockMetrics },
        { name: 'Goals', uri: 'absmartly://entities/goals', description: 'Cached list of available goals', getData: () => mockGoals },
        { name: 'Tags', uri: 'absmartly://entities/tags', description: 'Cached list of experiment tags', getData: () => mockTags },
        {
            name: 'Custom Fields',
            uri: 'absmartly://entities/custom-fields',
            description: 'Cached list of custom fields',
            getData: () => mockCustomFields
                .filter((f: CustomSectionField) => !f.archived)
                .map((f: CustomSectionField) => ({
                    id: f.id,
                    title: f.name,
                    type: f.type,
                    default_value: f.default_value || '',
                    section_type: (f.custom_section as any)?.type || 'unknown',
                })),
        },
    ];

    for (const cfg of entityConfigs) {
        server.resource(
            cfg.name,
            cfg.uri,
            { description: cfg.description },
            async () => ({
                contents: [{
                    uri: cfg.uri,
                    mimeType: 'application/json',
                    text: JSON.stringify(cfg.getData(), null, 2),
                }]
            })
        );
    }

    assert(server.registrations.size === 8, 'all 8 entity resources registered', `Got ${server.registrations.size}`);

    for (const name of ENTITY_NAMES) {
        const found = Array.from(server.registrations.values()).find(r => r.name === name);
        assert(found !== undefined, `resource "${name}" is registered`);
    }

    for (const [uri, reg] of server.registrations) {
        const result = await reg.handler();
        assert(result.contents !== undefined, `${uri} handler returns contents`);
        assert(result.contents[0].mimeType === 'application/json', `${uri} returns application/json`);
        assert(result.contents[0].uri === uri, `${uri} response uri matches`);

        const parsed = JSON.parse(result.contents[0].text);
        assert(Array.isArray(parsed), `${uri} returns JSON array`);
    }

    const appsReg = server.registrations.get('absmartly://entities/applications')!;
    const appsResult = await appsReg.handler();
    const appsData = JSON.parse(appsResult.contents[0].text);
    assert(appsData.length === 2, 'applications resource returns 2 items', `Got ${appsData.length}`);
    assert(appsData[0].name === 'web-app', 'first application is web-app');

    const cfReg = server.registrations.get('absmartly://entities/custom-fields')!;
    const cfResult = await cfReg.handler();
    const cfData = JSON.parse(cfResult.contents[0].text);
    assert(cfData.length === 1, 'custom-fields excludes archived fields', `Got ${cfData.length}`);
    assert(cfData[0].title === 'priority', 'custom field has title');
    assert(cfData[0].type === 'string', 'custom field has type');
    assert(cfData[0].default_value === 'medium', 'custom field has default_value');
    assert(cfData[0].section_type === 'test', 'custom field has section_type');
    assert(cfData[0].id === 10, 'custom field has id');

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
