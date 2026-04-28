import { deriveEntity } from '@/server/audit';
import { describe, expect, it } from 'vitest';

describe('deriveEntity', () => {
  it('splits the procedure path on the first dot', () => {
    expect(deriveEntity('insurers.create', {})).toEqual({ entityType: 'insurers', entityId: '' });
    expect(deriveEntity('benefitYears.setState', {})).toEqual({
      entityType: 'benefitYears',
      entityId: '',
    });
  });

  it('falls back to the whole path when no dot is present', () => {
    expect(deriveEntity('healthcheck', {})).toEqual({ entityType: 'healthcheck', entityId: '' });
  });

  it('extracts entityId from input.id when present', () => {
    expect(deriveEntity('insurers.update', { id: 'cl_abc' })).toEqual({
      entityType: 'insurers',
      entityId: 'cl_abc',
    });
  });

  it('coerces non-string id values', () => {
    expect(deriveEntity('insurers.update', { id: 42 })).toEqual({
      entityType: 'insurers',
      entityId: '42',
    });
  });

  it('returns empty entityId when input is null or has no id', () => {
    expect(deriveEntity('foo.bar', null)).toEqual({ entityType: 'foo', entityId: '' });
    expect(deriveEntity('foo.bar', { name: 'x' })).toEqual({ entityType: 'foo', entityId: '' });
    expect(deriveEntity('foo.bar', undefined)).toEqual({ entityType: 'foo', entityId: '' });
  });
});
