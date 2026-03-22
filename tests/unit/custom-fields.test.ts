import type { CustomSectionField } from '@absmartly/cli/api-client';

const USER_FIELD_TYPE = 'user';

function autoPopulateCustomFields(
    data: Record<string, unknown>,
    customFields: CustomSectionField[],
    currentUserId: number | null,
): void {
    const existingValues = data.custom_section_field_values as Record<string, unknown> | undefined;
    if (existingValues && Object.keys(existingValues).length > 0) {
        return;
    }

    const experimentType = data.type as string | undefined;
    const fieldValues: Record<string, { type: string; value: string }> = {};

    for (const field of customFields) {
        if (field.archived) continue;
        if (!field.custom_section) continue;
        if (field.custom_section.type !== experimentType) continue;
        if (field.custom_section.archived) continue;

        let value = field.default_value || '';
        if (field.type === USER_FIELD_TYPE && currentUserId) {
            value = JSON.stringify({ selected: [{ userId: currentUserId }] });
        }

        fieldValues[String(field.id)] = { type: field.type, value };
    }

    const customFieldsByName = (data as any).custom_fields as Record<string, string> | undefined;
    if (customFieldsByName) {
        for (const [name, val] of Object.entries(customFieldsByName)) {
            const matching = customFields.find(f => f.name === name && !f.archived);
            if (matching) {
                fieldValues[String(matching.id)] = { type: matching.type, value: val };
            }
        }
        delete (data as any).custom_fields;
    }

    data.custom_section_field_values = fieldValues;
}

function makeField(overrides: Partial<CustomSectionField> & { id: number; name: string; type: string }): CustomSectionField {
    return {
        archived: false,
        default_value: '',
        custom_section: null as any,
        ...overrides,
    } as CustomSectionField;
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

    const testField = makeField({
        id: 1,
        name: 'priority',
        type: 'string',
        default_value: 'medium',
        custom_section: { type: 'test', archived: false } as any,
    });

    const featureField = makeField({
        id: 2,
        name: 'feature_area',
        type: 'string',
        default_value: 'core',
        custom_section: { type: 'feature', archived: false } as any,
    });

    const archivedField = makeField({
        id: 3,
        name: 'old_field',
        type: 'string',
        archived: true,
        custom_section: { type: 'test', archived: false } as any,
    });

    const archivedSectionField = makeField({
        id: 4,
        name: 'section_archived',
        type: 'string',
        custom_section: { type: 'test', archived: true } as any,
    });

    const userField = makeField({
        id: 5,
        name: 'owner',
        type: 'user',
        custom_section: { type: 'test', archived: false } as any,
    });

    const noSectionField = makeField({
        id: 6,
        name: 'orphan',
        type: 'string',
        custom_section: null as any,
    });

    const allFields = [testField, featureField, archivedField, archivedSectionField, userField, noSectionField];

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(values !== undefined, 'populates custom_section_field_values when empty');
        assert('1' in values, 'includes test-type field (id=1)');
        assert(values['1'].type === 'string', 'field 1 has correct type');
        assert(values['1'].value === 'medium', 'field 1 uses default_value');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(!('2' in values), 'excludes feature-type field when type=test');
    }

    {
        const data: Record<string, unknown> = { type: 'feature' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert('2' in values, 'includes feature-type field when type=feature');
        assert(!('1' in values), 'excludes test-type field when type=feature');
        assert(values['2'].value === 'core', 'feature field uses default_value');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(!('3' in values), 'excludes archived field');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(!('4' in values), 'excludes field with archived section');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, 42);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert('5' in values, 'includes user-type field');
        assert(values['5'].type === 'user', 'user field has correct type');
        const parsed = JSON.parse(values['5'].value);
        assert(parsed.selected[0].userId === 42, 'user field populated with currentUserId');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert('5' in values, 'user field included when no currentUserId');
        assert(values['5'].value === '', 'user field is empty string when no currentUserId');
    }

    {
        const data: Record<string, unknown> = { type: 'test' };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(!('6' in values), 'excludes field without custom_section');
    }

    {
        const data: Record<string, unknown> = {
            type: 'test',
            custom_fields: { priority: 'high' },
        };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(values['1'].value === 'high', 'custom_fields by name overrides default_value');
        assert(values['1'].type === 'string', 'custom_fields by name preserves field type');
        assert(!('custom_fields' in data), 'custom_fields key is deleted after processing');
    }

    {
        const existingValues = { '99': { type: 'string', value: 'existing' } };
        const data: Record<string, unknown> = {
            type: 'test',
            custom_section_field_values: existingValues,
        };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, any>;
        assert('99' in values, 'existing values preserved');
        assert(!('1' in values), 'does not add new fields when existing values present');
    }

    {
        const data: Record<string, unknown> = {
            type: 'test',
            custom_section_field_values: {},
        };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert('1' in values, 'populates when custom_section_field_values is empty object');
    }

    {
        const data: Record<string, unknown> = {
            type: 'test',
            custom_fields: { nonexistent_field: 'value' },
        };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(values['1'].value === 'medium', 'unmatched custom_fields name does not affect output');
        assert(!('custom_fields' in data), 'custom_fields deleted even when no match found');
    }

    {
        const data: Record<string, unknown> = {
            type: 'test',
            custom_fields: { old_field: 'value' },
        };
        autoPopulateCustomFields(data, allFields, null);
        const values = data.custom_section_field_values as Record<string, { type: string; value: string }>;
        assert(!('3' in values), 'custom_fields by name ignores archived fields');
    }

    return {
        success: failed === 0,
        message: `${passed} passed, ${failed} failed`,
        testCount: passed + failed,
        details
    };
}
