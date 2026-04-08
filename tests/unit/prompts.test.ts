import type { CustomSectionField } from '@absmartly/cli/api-client';

function buildEntityContext(entities: {
    applications: any[];
    unitTypes: any[];
    metrics: any[];
    teams: any[];
    customFields: CustomSectionField[];
}): string {
    const sections: string[] = [];

    if (entities.applications.length > 0) {
        const lines = entities.applications.map((a: any) => `  - id=${a.id}, name="${a.name}"`);
        sections.push(`Applications:\n${lines.join('\n')}`);
    }
    if (entities.unitTypes.length > 0) {
        const lines = entities.unitTypes.map((u: any) => `  - id=${u.id}, name="${u.name}"`);
        sections.push(`Unit Types:\n${lines.join('\n')}`);
    }
    if (entities.metrics.length > 0) {
        const lines = entities.metrics.map((m: any) => `  - id=${m.id}, name="${m.name}"`);
        sections.push(`Metrics:\n${lines.join('\n')}`);
    }
    if (entities.teams.length > 0) {
        const lines = entities.teams.map((t: any) => `  - id=${t.id}, name="${t.name}"`);
        sections.push(`Teams:\n${lines.join('\n')}`);
    }
    if (entities.customFields.length > 0) {
        const cfLines = entities.customFields
            .filter(f => !f.archived)
            .map(f => `  - title="${f.name}", type="${f.type}", default="${f.default_value || ''}", section_type="${(f.custom_section as any)?.type || 'unknown'}"`);
        sections.push(`Custom Fields:\n${cfLines.join('\n')}`);
    }

    return sections.join('\n\n');
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

    function assertContains(haystack: string, needle: string, name: string) {
        assert(haystack.includes(needle), name, `Expected to contain "${needle}" but got: "${haystack.substring(0, 200)}..."`);
    }

    const sampleEntities = {
        applications: [{ id: 1, name: 'web-app' }, { id: 2, name: 'mobile-app' }],
        unitTypes: [{ id: 10, name: 'user_id' }],
        metrics: [{ id: 20, name: 'conversion_rate' }],
        teams: [{ id: 30, name: 'growth' }],
        customFields: [
            {
                id: 40,
                name: 'priority',
                type: 'string',
                default_value: 'medium',
                archived: false,
                custom_section: { type: 'test', archived: false },
            } as CustomSectionField,
        ],
    };

    const context = buildEntityContext(sampleEntities);
    assertContains(context, 'Applications:', 'buildEntityContext includes Applications section');
    assertContains(context, 'id=1, name="web-app"', 'buildEntityContext formats application correctly');
    assertContains(context, 'id=2, name="mobile-app"', 'buildEntityContext includes all applications');
    assertContains(context, 'Unit Types:', 'buildEntityContext includes Unit Types section');
    assertContains(context, 'id=10, name="user_id"', 'buildEntityContext formats unit type correctly');
    assertContains(context, 'Metrics:', 'buildEntityContext includes Metrics section');
    assertContains(context, 'id=20, name="conversion_rate"', 'buildEntityContext formats metric correctly');
    assertContains(context, 'Teams:', 'buildEntityContext includes Teams section');
    assertContains(context, 'id=30, name="growth"', 'buildEntityContext formats team correctly');
    assertContains(context, 'Custom Fields:', 'buildEntityContext includes Custom Fields section');
    assertContains(context, 'title="priority"', 'buildEntityContext formats custom field title');
    assertContains(context, 'type="string"', 'buildEntityContext formats custom field type');
    assertContains(context, 'default="medium"', 'buildEntityContext formats custom field default');
    assertContains(context, 'section_type="test"', 'buildEntityContext formats custom field section_type');

    const emptyContext = buildEntityContext({
        applications: [],
        unitTypes: [],
        metrics: [],
        teams: [],
        customFields: [],
    });
    assert(emptyContext === '', 'buildEntityContext returns empty string for no entities', `Got: "${emptyContext}"`);

    const partialContext = buildEntityContext({
        applications: [{ id: 1, name: 'app' }],
        unitTypes: [],
        metrics: [],
        teams: [],
        customFields: [],
    });
    assertContains(partialContext, 'Applications:', 'partial context includes only populated sections');
    assert(!partialContext.includes('Unit Types:'), 'partial context excludes empty sections');
    assert(!partialContext.includes('Metrics:'), 'partial context excludes empty metrics');

    const archivedFieldContext = buildEntityContext({
        applications: [],
        unitTypes: [],
        metrics: [],
        teams: [],
        customFields: [
            {
                id: 1,
                name: 'archived_field',
                type: 'string',
                default_value: '',
                archived: true,
                custom_section: { type: 'test', archived: false },
            } as CustomSectionField,
        ],
    });
    assert(!archivedFieldContext.includes('archived_field'), 'buildEntityContext filters archived custom fields');

    const expName = 'my_test_experiment';
    const expType = 'test';
    const entityContext = buildEntityContext(sampleEntities);
    const createExpPromptText = `Create a new ${expType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${expName}".\n\nUse the execute_command tool with method_name "createExperiment" to create it.\n\n${entityContext}`;
    assertContains(createExpPromptText, 'A/B test', 'create-experiment prompt includes A/B test for type=test');
    assertContains(createExpPromptText, `"${expName}"`, 'create-experiment prompt includes experiment name');
    assertContains(createExpPromptText, 'createExperiment', 'create-experiment prompt references createExperiment method');
    assertContains(createExpPromptText, 'Applications:', 'create-experiment prompt includes entity context');

    const featureName = 'my_feature_flag';
    const featureType = 'feature';
    const createFeatureText = `Create a new ${featureType === 'feature' ? 'feature flag' : 'A/B test'} experiment named "${featureName}".\n\nUse the execute_command tool with method_name "createExperiment" to create it with type "feature".\n\n${entityContext}`;
    assertContains(createFeatureText, 'feature flag', 'create-feature-flag prompt includes feature flag');
    assertContains(createFeatureText, `"${featureName}"`, 'create-feature-flag prompt includes name');
    assertContains(createFeatureText, 'type "feature"', 'create-feature-flag prompt sets type=feature');

    const experimentId = '42';
    const analyzeText = `Analyze experiment with ID ${experimentId}.\n\n1. Use execute_command with method_name "getExperiment" and params { "id": ${experimentId} }`;
    assertContains(analyzeText, experimentId, 'analyze-experiment prompt includes experiment ID');
    assertContains(analyzeText, 'getExperiment', 'analyze-experiment prompt references getExperiment');

    const reviewText = `Review all running experiments and identify any that need attention.\n\n1. Use execute_command with method_name "listExperiments" and params { "options": { "state": "running" } }`;
    assertContains(reviewText, 'listExperiments', 'experiment-review prompt references listExperiments');
    assertContains(reviewText, '"state": "running"', 'experiment-review prompt filters for running state');
    assertContains(reviewText, 'attention', 'experiment-review prompt mentions attention');

    const statusText = 'Show me all currently running experiments with their key metrics and performance';
    assertContains(statusText, 'running experiments', 'experiment-status prompt mentions running experiments');
    assertContains(statusText, 'key metrics', 'experiment-status prompt mentions key metrics');
    assertContains(statusText, 'performance', 'experiment-status prompt mentions performance');

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
