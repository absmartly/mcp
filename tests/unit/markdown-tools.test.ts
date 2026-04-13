import {
  parseExperimentMarkdown,
  generateTemplate,
  buildExperimentPayload,
} from '@absmartly/cli/api-client';

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

  function assertEquals(actual: unknown, expected: unknown, name: string) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, name, `Expected ${expectedStr}, got ${actualStr}`);
  }

  // --- parseExperimentMarkdown ---

  {
    const markdown = `---
name: my_experiment
type: test
percentages: "60/40"
---

## Basic Info

display_name: My Experiment

## Variants

### variant_0

name: control
config: {"color": "blue"}

### variant_1

name: treatment
config: {"color": "red"}
`;
    const result = parseExperimentMarkdown(markdown);
    assertEquals(result.name, 'my_experiment', 'parseExperimentMarkdown: extracts name from frontmatter');
    assertEquals(result.type, 'test', 'parseExperimentMarkdown: extracts type from frontmatter');
    assertEquals(result.percentages, '60/40', 'parseExperimentMarkdown: extracts percentages from frontmatter');
    assertEquals(result.display_name, 'My Experiment', 'parseExperimentMarkdown: extracts display_name from section');
    assert(result.variants.length === 2, 'parseExperimentMarkdown: parses two variants', `Got ${result.variants?.length}`);
    assertEquals(result.variants[0].name, 'control', 'parseExperimentMarkdown: variant 0 name is control');
    assertEquals(result.variants[1].name, 'treatment', 'parseExperimentMarkdown: variant 1 name is treatment');
    assertEquals(result.variants[0].config, '{"color": "blue"}', 'parseExperimentMarkdown: variant 0 config parsed');
  }

  // --- parseExperimentMarkdown: minimal YAML ---

  {
    const markdown = `---
name: minimal_exp
---
`;
    const result = parseExperimentMarkdown(markdown);
    assertEquals(result.name, 'minimal_exp', 'parseExperimentMarkdown minimal: extracts name');
    assertEquals(result.type, 'test', 'parseExperimentMarkdown minimal: defaults type to test');
    assertEquals(result.percentages, '50/50', 'parseExperimentMarkdown minimal: defaults percentages to 50/50');
    assert(Array.isArray(result.variants) && result.variants.length === 0, 'parseExperimentMarkdown minimal: empty variants array');
  }

  // --- parseExperimentMarkdown: invalid YAML ---

  {
    const badMarkdown = `---
name: [invalid
  yaml: {broken
---
`;
    let threw = false;
    try {
      parseExperimentMarkdown(badMarkdown);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes('Invalid YAML'), 'parseExperimentMarkdown invalid YAML: error mentions YAML', `Got: ${e.message}`);
    }
    assert(threw, 'parseExperimentMarkdown invalid YAML: throws on bad frontmatter');
  }

  // --- parseExperimentMarkdown: custom fields ---

  {
    const markdown = `---
name: custom_exp
---

## Custom Fields

### Hypothesis

We believe X will improve Y

### Success Criteria

Primary metric improves by 10%
`;
    const result = parseExperimentMarkdown(markdown);
    assert(result.custom_fields !== undefined, 'parseExperimentMarkdown custom fields: has custom_fields');
    assertEquals(result.custom_fields?.['Hypothesis'], 'We believe X will improve Y', 'parseExperimentMarkdown custom fields: parses hypothesis');
    assertEquals(result.custom_fields?.['Success Criteria'], 'Primary metric improves by 10%', 'parseExperimentMarkdown custom fields: parses success criteria');
  }

  // --- generateTemplate ---

  {
    const context = {
      applications: [{ id: 1, name: 'web' }, { id: 2, name: 'mobile' }],
      unitTypes: [{ id: 1, name: 'user_id' }, { id: 2, name: 'session_id' }],
      metrics: [{ id: 1, name: 'conversion' }, { id: 2, name: 'revenue' }],
    };
    const result = generateTemplate(context);
    assert(result.includes('unit_type: user_id'), 'generateTemplate: includes first unit type');
    assert(result.includes('application: web'), 'generateTemplate: includes first application');
    assert(result.includes('primary_metric: conversion'), 'generateTemplate: includes first metric');
    assert(result.includes('Available: user_id, session_id'), 'generateTemplate: lists available unit types');
    assert(result.includes('Available: web, mobile'), 'generateTemplate: lists available applications');
    assert(result.includes('Available: conversion, revenue'), 'generateTemplate: lists available metrics');
  }

  {
    const context = {
      applications: [],
      unitTypes: [],
      metrics: [],
    };
    const result = generateTemplate(context);
    assert(result.includes('unit_type: user_id'), 'generateTemplate empty context: falls back to user_id');
    assert(result.includes('application: www'), 'generateTemplate empty context: falls back to www');
  }

  {
    const context = {
      applications: [{ id: 1, name: 'web' }],
      unitTypes: [{ id: 1, name: 'user_id' }],
      metrics: [{ id: 1, name: 'conversion' }],
    };
    const result = generateTemplate(context, { name: 'checkout_test', type: 'feature' });
    assert(result.includes('name: checkout_test'), 'generateTemplate with opts: uses provided name');
    assert(result.includes('type: feature'), 'generateTemplate with opts: uses provided type');
  }

  // --- buildExperimentPayload ---
  // Note: buildExperimentPayload is async and returns { payload, warnings }

  {
    const template = {
      name: 'test_exp',
      type: 'test',
      percentages: '50/50',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [{ id: 1, name: 'web' }],
      unitTypes: [{ id: 10, name: 'user_id' }],
      metrics: [{ id: 100, name: 'conversion' }],
    };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.name, 'test_exp', 'buildExperimentPayload: sets name');
    assertEquals(payload.type, 'test', 'buildExperimentPayload: sets type');
    assertEquals(payload.percentages, '50/50', 'buildExperimentPayload: sets percentages');
    const variants = payload.variants as Array<{ name: string }>;
    assert(variants.length === 2, 'buildExperimentPayload: creates default 2 variants when empty', `Got ${variants.length}`);
    assertEquals(variants[0].name, 'control', 'buildExperimentPayload: default variant 0 is control');
    assertEquals(variants[1].name, 'treatment', 'buildExperimentPayload: default variant 1 is treatment');
  }

  // --- buildExperimentPayload: resolves application name to ID ---

  {
    const template = {
      name: 'app_exp',
      application: 'mobile',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [{ id: 1, name: 'web' }, { id: 2, name: 'mobile' }],
      unitTypes: [],
      metrics: [],
    };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.applications, [{ application_id: 2, application_version: '0' }], 'buildExperimentPayload: resolves application name to ID');
  }

  // --- buildExperimentPayload: resolves unit_type name to ID ---

  {
    const template = {
      name: 'unit_exp',
      unit_type: 'session_id',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [],
      unitTypes: [{ id: 10, name: 'user_id' }, { id: 20, name: 'session_id' }],
      metrics: [],
    };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.unit_type, { unit_type_id: 20 }, 'buildExperimentPayload: resolves unit_type name to ID');
  }

  // --- buildExperimentPayload: resolves metric name to ID ---

  {
    const template = {
      name: 'metric_exp',
      primary_metric: 'revenue',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [],
      unitTypes: [],
      metrics: [{ id: 100, name: 'conversion' }, { id: 200, name: 'revenue' }],
    };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.primary_metric, { metric_id: 200 }, 'buildExperimentPayload: resolves primary_metric name to ID');
  }

  // --- buildExperimentPayload: throws when name not found ---

  {
    const template = {
      name: 'missing_app',
      application: 'nonexistent',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [{ id: 1, name: 'web' }],
      unitTypes: [],
      metrics: [],
    };
    let threw = false;
    let errorMsg = '';
    try {
      await buildExperimentPayload(template, context);
    } catch (e: any) {
      threw = true;
      errorMsg = e.message;
    }
    assert(threw, 'buildExperimentPayload: throws when application name not found');
    assert(errorMsg.includes('not found'), 'buildExperimentPayload: error mentions not found', `Got: ${errorMsg}`);
    assert(errorMsg.includes('web'), 'buildExperimentPayload: error lists available names', `Got: ${errorMsg}`);
  }

  // --- buildExperimentPayload: uses defaults for missing fields ---

  {
    const template = {
      name: 'defaults_exp',
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [],
      unitTypes: [],
      metrics: [],
    };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.type, 'test', 'buildExperimentPayload defaults: type is test');
    assertEquals(payload.state, 'ready', 'buildExperimentPayload defaults: state is ready');
    assertEquals(payload.percentage_of_traffic, 100, 'buildExperimentPayload defaults: traffic is 100');
    assertEquals(payload.percentages, '50/50', 'buildExperimentPayload defaults: percentages is 50/50');
    assertEquals(payload.analysis_type, 'group_sequential', 'buildExperimentPayload defaults: analysis_type is group_sequential');
    assertEquals(payload.nr_variants, 2, 'buildExperimentPayload defaults: nr_variants is 2');
  }

  // --- buildExperimentPayload: secondary and guardrail metrics ---

  {
    const template = {
      name: 'multi_metric',
      primary_metric: 'conversion',
      secondary_metrics: ['revenue', 'pageviews'],
      guardrail_metrics: ['latency'],
      variants: [],
      custom_fields: {},
    };
    const context = {
      applications: [],
      unitTypes: [],
      metrics: [
        { id: 1, name: 'conversion' },
        { id: 2, name: 'revenue' },
        { id: 3, name: 'pageviews' },
        { id: 4, name: 'latency' },
      ],
    };
    const { payload } = await buildExperimentPayload(template, context);
    const secondaryMetrics = payload.secondary_metrics as Array<{ metric_id: number; type?: string }>;
    assert(secondaryMetrics.length > 0, 'buildExperimentPayload: has secondary metrics');
    const hasRevenue = secondaryMetrics.some((m: any) => m.metric_id === 2);
    const hasPageviews = secondaryMetrics.some((m: any) => m.metric_id === 3);
    const hasLatency = secondaryMetrics.some((m: any) => m.metric_id === 4);
    assert(hasRevenue, 'buildExperimentPayload: resolves revenue secondary metric');
    assert(hasPageviews, 'buildExperimentPayload: resolves pageviews secondary metric');
    assert(hasLatency, 'buildExperimentPayload: resolves latency guardrail metric');
  }

  // --- buildExperimentPayload: custom variants ---

  {
    const template = {
      name: 'custom_variants',
      variants: [
        { name: 'baseline', variant: 0, config: '{"version": "a"}' },
        { name: 'new_design', variant: 1, config: '{"version": "b"}' },
        { name: 'bold_design', variant: 2, config: '{"version": "c"}' },
      ],
      custom_fields: {},
    };
    const context = { applications: [], unitTypes: [], metrics: [] };
    const { payload } = await buildExperimentPayload(template, context);
    assertEquals(payload.nr_variants, 3, 'buildExperimentPayload custom variants: nr_variants is 3');
    const variants = payload.variants as Array<{ name: string; config: string }>;
    assertEquals(variants[0].name, 'baseline', 'buildExperimentPayload custom variants: variant 0 name');
    assertEquals(variants[2].name, 'bold_design', 'buildExperimentPayload custom variants: variant 2 name');
    assertEquals(variants[1].config, '{"version":"b"}', 'buildExperimentPayload custom variants: config is re-serialized JSON');
  }

  const total = passed + failed;
  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: total,
    details
  };
}
