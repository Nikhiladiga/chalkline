import { describe, expect, it } from 'vitest';
import { findIcons, iconNames } from './iconCatalog';

describe('icon catalog', () => {
  it('searches aliases, human-readable phrases and the complete catalog', () => {
    expect(findIcons('s3')[0]).toBe('aws-simple-storage-service');
    expect(findIcons('S3 bucket')[0]).toBe('aws-simple-storage-service');
    expect(findIcons('aws lambda')[0]).toBe('aws-lambda');
    expect(findIcons('')).toHaveLength(iconNames.length);
    expect(findIcons('not-an-existing-icon-xyz')).toEqual([]);
  });

  it('filters providers and keeps common icons easy to find', () => {
    expect(findIcons('', 'aws').every((n) => n.startsWith('aws-'))).toBe(true);
    expect(findIcons('lambda', 'azure')).toEqual([]);
    expect(findIcons('').slice(0, 15)).toContain('user');
    expect(findIcons('user', 'general')).toContain('user');
    expect(findIcons('', 'general').some((n) => /^(aws|azure|gcp)-/.test(n))).toBe(false);
  });
});
