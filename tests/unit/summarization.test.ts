import {
    summarizeExperimentRow,
    summarizeExperiment,
    summarizeMetricRow,
    summarizeMetric,
    summarizeGoalRow,
    summarizeGoal,
    summarizeTeamRow,
    summarizeTeam,
    summarizeUserRow,
    summarizeUserDetail,
    summarizeSegmentRow,
    summarizeSegment,
} from '@absmartly/cli/api-client';

const EXPERIMENT_LIST_METHODS = new Set([
    'listExperiments', 'searchExperiments',
]);
const EXPERIMENT_SINGLE_METHODS = new Set([
    'getExperiment', 'createExperiment', 'updateExperiment',
    'startExperiment', 'stopExperiment', 'developmentExperiment',
    'restartExperiment', 'fullOnExperiment',
]);
const METRIC_LIST_METHODS = new Set(['listMetrics']);
const METRIC_SINGLE_METHODS = new Set(['getMetric', 'createMetric', 'updateMetric']);
const GOAL_LIST_METHODS = new Set(['listGoals']);
const GOAL_SINGLE_METHODS = new Set(['getGoal', 'createGoal', 'updateGoal']);
const TEAM_LIST_METHODS = new Set(['listTeams']);
const TEAM_SINGLE_METHODS = new Set(['getTeam', 'createTeam', 'updateTeam']);
const USER_LIST_METHODS = new Set(['listUsers']);
const USER_SINGLE_METHODS = new Set(['getUser', 'createUser', 'updateUser']);
const SEGMENT_LIST_METHODS = new Set(['listSegments']);
const SEGMENT_SINGLE_METHODS = new Set(['getSegment', 'createSegment', 'updateSegment']);

function isSingleEntity(result: unknown): result is Record<string, unknown> {
    return result !== null && typeof result === 'object' && !Array.isArray(result) && 'id' in result;
}

function summarizeResult(methodName: string, result: unknown, show: string[], exclude: string[]): unknown {
    if (EXPERIMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((exp: any) => summarizeExperimentRow(exp, show, exclude));
    }
    if (EXPERIMENT_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeExperiment(result as Record<string, unknown>, show, exclude);
    }
    if (METRIC_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((m: any) => summarizeMetricRow(m));
    }
    if (METRIC_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeMetric(result as Record<string, unknown>);
    }
    if (GOAL_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((g: any) => summarizeGoalRow(g));
    }
    if (GOAL_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeGoal(result as Record<string, unknown>);
    }
    if (TEAM_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((t: any) => summarizeTeamRow(t));
    }
    if (TEAM_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeTeam(result as Record<string, unknown>);
    }
    if (USER_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((u: any) => summarizeUserRow(u));
    }
    if (USER_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeUserDetail(result as Record<string, unknown>);
    }
    if (SEGMENT_LIST_METHODS.has(methodName) && Array.isArray(result)) {
        return result.map((s: any) => summarizeSegmentRow(s));
    }
    if (SEGMENT_SINGLE_METHODS.has(methodName) && isSingleEntity(result)) {
        return summarizeSegment(result as Record<string, unknown>);
    }
    return result;
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

    assert(EXPERIMENT_LIST_METHODS.has('listExperiments'), 'EXPERIMENT_LIST_METHODS contains listExperiments');
    assert(EXPERIMENT_LIST_METHODS.has('searchExperiments'), 'EXPERIMENT_LIST_METHODS contains searchExperiments');
    assert(EXPERIMENT_LIST_METHODS.size === 2, 'EXPERIMENT_LIST_METHODS has exactly 2 entries', `Got ${EXPERIMENT_LIST_METHODS.size}`);

    assert(EXPERIMENT_SINGLE_METHODS.has('getExperiment'), 'EXPERIMENT_SINGLE_METHODS contains getExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('createExperiment'), 'EXPERIMENT_SINGLE_METHODS contains createExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('updateExperiment'), 'EXPERIMENT_SINGLE_METHODS contains updateExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('startExperiment'), 'EXPERIMENT_SINGLE_METHODS contains startExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('stopExperiment'), 'EXPERIMENT_SINGLE_METHODS contains stopExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('developmentExperiment'), 'EXPERIMENT_SINGLE_METHODS contains developmentExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('restartExperiment'), 'EXPERIMENT_SINGLE_METHODS contains restartExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.has('fullOnExperiment'), 'EXPERIMENT_SINGLE_METHODS contains fullOnExperiment');
    assert(EXPERIMENT_SINGLE_METHODS.size === 8, 'EXPERIMENT_SINGLE_METHODS has exactly 8 entries', `Got ${EXPERIMENT_SINGLE_METHODS.size}`);

    assert(METRIC_LIST_METHODS.has('listMetrics'), 'METRIC_LIST_METHODS contains listMetrics');
    assert(METRIC_SINGLE_METHODS.has('getMetric'), 'METRIC_SINGLE_METHODS contains getMetric');
    assert(METRIC_SINGLE_METHODS.has('createMetric'), 'METRIC_SINGLE_METHODS contains createMetric');
    assert(METRIC_SINGLE_METHODS.has('updateMetric'), 'METRIC_SINGLE_METHODS contains updateMetric');

    assert(GOAL_LIST_METHODS.has('listGoals'), 'GOAL_LIST_METHODS contains listGoals');
    assert(GOAL_SINGLE_METHODS.has('getGoal'), 'GOAL_SINGLE_METHODS contains getGoal');
    assert(GOAL_SINGLE_METHODS.has('createGoal'), 'GOAL_SINGLE_METHODS contains createGoal');
    assert(GOAL_SINGLE_METHODS.has('updateGoal'), 'GOAL_SINGLE_METHODS contains updateGoal');

    assert(TEAM_LIST_METHODS.has('listTeams'), 'TEAM_LIST_METHODS contains listTeams');
    assert(TEAM_SINGLE_METHODS.has('getTeam'), 'TEAM_SINGLE_METHODS contains getTeam');

    assert(USER_LIST_METHODS.has('listUsers'), 'USER_LIST_METHODS contains listUsers');
    assert(USER_SINGLE_METHODS.has('getUser'), 'USER_SINGLE_METHODS contains getUser');

    assert(SEGMENT_LIST_METHODS.has('listSegments'), 'SEGMENT_LIST_METHODS contains listSegments');
    assert(SEGMENT_SINGLE_METHODS.has('getSegment'), 'SEGMENT_SINGLE_METHODS contains getSegment');

    const mockExperiment = { id: 1, name: 'test_exp', state: 'running', type: 'test', created_at: '2024-01-01', extra_field: 'should_be_removed' };

    const listResult = summarizeResult('listExperiments', [mockExperiment], [], []) as any[];
    assert(Array.isArray(listResult), 'listExperiments returns array');
    assert(listResult.length === 1, 'listExperiments result has 1 item');
    assert(listResult[0].id === 1, 'listExperiments preserves id');
    assert(listResult[0].name === 'test_exp', 'listExperiments preserves name');
    assert(listResult[0].extra_field === undefined, 'listExperiments removes extra fields');

    const singleResult = summarizeResult('getExperiment', mockExperiment, [], []) as any;
    assert(singleResult.id === 1, 'getExperiment preserves id');
    assert(singleResult.name === 'test_exp', 'getExperiment preserves name');
    assert(singleResult.extra_field === undefined, 'getExperiment removes extra fields');

    const rawData = { foo: 'bar', baz: 123 };
    const passthrough = summarizeResult('someUnknownMethod', rawData, [], []);
    assert(passthrough === rawData, 'non-matching method returns raw data');

    const nonEntityData = [1, 2, 3];
    const nonEntityResult = summarizeResult('getExperiment', nonEntityData, [], []);
    assert(nonEntityResult === nonEntityData, 'getExperiment with non-entity (array) returns raw data');

    const mockMetric = { id: 10, name: 'clicks', type: 'count', extra: 'gone' };
    const metricListResult = summarizeResult('listMetrics', [mockMetric], [], []) as any[];
    assert(metricListResult[0].id === 10, 'listMetrics preserves id');
    assert(metricListResult[0].name === 'clicks', 'listMetrics preserves name');
    assert(metricListResult[0].extra === undefined, 'listMetrics removes extra fields');

    const metricSingleResult = summarizeResult('getMetric', mockMetric, [], []) as any;
    assert(metricSingleResult.id === 10, 'getMetric preserves id');
    assert(metricSingleResult.extra === undefined, 'getMetric removes extra fields');

    const mockGoal = { id: 20, name: 'purchase', tag: 'buy', extra: 'gone' };
    const goalListResult = summarizeResult('listGoals', [mockGoal], [], []) as any[];
    assert(goalListResult[0].id === 20, 'listGoals preserves id');
    assert(goalListResult[0].extra === undefined, 'listGoals removes extra fields');

    const goalSingleResult = summarizeResult('getGoal', mockGoal, [], []) as any;
    assert(goalSingleResult.id === 20, 'getGoal preserves id');

    const mockTeam = { id: 30, name: 'frontend', description: 'FE team', extra: 'gone' };
    const teamListResult = summarizeResult('listTeams', [mockTeam], [], []) as any[];
    assert(teamListResult[0].id === 30, 'listTeams preserves id');
    assert(teamListResult[0].extra === undefined, 'listTeams removes extra fields');

    const teamSingleResult = summarizeResult('getTeam', mockTeam, [], []) as any;
    assert(teamSingleResult.id === 30, 'getTeam preserves id');

    const mockUser = { id: 40, first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com', extra: 'gone' };
    const userListResult = summarizeResult('listUsers', [mockUser], [], []) as any[];
    assert(userListResult[0].id === 40, 'listUsers preserves id');
    assert(userListResult[0].email === 'jane@test.com', 'listUsers preserves email');
    assert(userListResult[0].extra === undefined, 'listUsers removes extra fields');

    const userSingleResult = summarizeResult('getUser', mockUser, [], []) as any;
    assert(userSingleResult.id === 40, 'getUser preserves id');

    const mockSegment = { id: 50, name: 'vip_users', attribute: 'tier', extra: 'gone' };
    const segmentListResult = summarizeResult('listSegments', [mockSegment], [], []) as any[];
    assert(segmentListResult[0].id === 50, 'listSegments preserves id');
    assert(segmentListResult[0].extra === undefined, 'listSegments removes extra fields');

    const segmentSingleResult = summarizeResult('getSegment', mockSegment, [], []) as any;
    assert(segmentSingleResult.id === 50, 'getSegment preserves id');

    const expRowDirect = summarizeExperimentRow(mockExperiment, [], []) as any;
    assert(expRowDirect.id === 1, 'summarizeExperimentRow direct call preserves id');
    assert(typeof expRowDirect.state === 'string', 'summarizeExperimentRow has state field');

    const metricRowDirect = summarizeMetricRow(mockMetric) as any;
    assert(metricRowDirect.id === 10, 'summarizeMetricRow direct call preserves id');
    assert(typeof metricRowDirect.type === 'string', 'summarizeMetricRow has type field');

    const goalRowDirect = summarizeGoalRow(mockGoal) as any;
    assert(goalRowDirect.id === 20, 'summarizeGoalRow direct call preserves id');

    const teamRowDirect = summarizeTeamRow(mockTeam) as any;
    assert(teamRowDirect.id === 30, 'summarizeTeamRow direct call preserves id');
    assert(teamRowDirect.name === 'frontend', 'summarizeTeamRow preserves name');

    const userRowDirect = summarizeUserRow(mockUser) as any;
    assert(userRowDirect.id === 40, 'summarizeUserRow direct call preserves id');
    assert(userRowDirect.name === 'Jane Doe', 'summarizeUserRow combines first/last name');

    const segmentRowDirect = summarizeSegmentRow(mockSegment) as any;
    assert(segmentRowDirect.id === 50, 'summarizeSegmentRow direct call preserves id');

    const expSingleDirect = summarizeExperiment(mockExperiment, [], []) as any;
    assert(expSingleDirect.id === 1, 'summarizeExperiment direct preserves id');
    assert('created_at' in expSingleDirect, 'summarizeExperiment includes created_at');

    const metricSingleDirect = summarizeMetric(mockMetric) as any;
    assert(metricSingleDirect.id === 10, 'summarizeMetric direct preserves id');

    const goalSingleDirect = summarizeGoal(mockGoal) as any;
    assert(goalSingleDirect.id === 20, 'summarizeGoal direct preserves id');

    const teamSingleDirect = summarizeTeam(mockTeam) as any;
    assert(teamSingleDirect.id === 30, 'summarizeTeam direct preserves id');

    const userDetailDirect = summarizeUserDetail(mockUser) as any;
    assert(userDetailDirect.id === 40, 'summarizeUserDetail direct preserves id');

    const segmentSingleDirect = summarizeSegment(mockSegment) as any;
    assert(segmentSingleDirect.id === 50, 'summarizeSegment direct preserves id');

    for (const method of ['createExperiment', 'updateExperiment', 'startExperiment', 'stopExperiment']) {
        const result = summarizeResult(method, mockExperiment, [], []) as any;
        assert(result.id === 1, `${method} summarizes single experiment`);
        assert(result.extra_field === undefined, `${method} removes extra fields`);
    }

    for (const method of ['createMetric', 'updateMetric']) {
        const result = summarizeResult(method, mockMetric, [], []) as any;
        assert(result.id === 10, `${method} summarizes single metric`);
    }

    for (const method of ['createGoal', 'updateGoal']) {
        const result = summarizeResult(method, mockGoal, [], []) as any;
        assert(result.id === 20, `${method} summarizes single goal`);
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
