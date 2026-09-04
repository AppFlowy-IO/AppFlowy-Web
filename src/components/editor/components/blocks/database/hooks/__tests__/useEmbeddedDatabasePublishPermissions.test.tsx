import { render, screen } from '@testing-library/react';

import { UIVariant } from '@/application/types';

import { EmbeddedDatabasePermissionsResolver } from '../useEmbeddedDatabasePermissions';

describe('published embedded database permissions', () => {
  it('resolves static permissions without an AppProvider', () => {
    render(
      <EmbeddedDatabasePermissionsResolver
        sourceViewId='published-view-id'
        sourceDatabaseId='published-database-id'
        variant={UIVariant.Publish}
        inheritedReadOnly={false}
        publishCanWrite
        publishCanShare
      >
        {(permissions) => <output>{JSON.stringify(permissions)}</output>}
      </EmbeddedDatabasePermissionsResolver>
    );

    expect(screen.getByText('{"readOnly":false,"canWrite":true,"canShare":true}')).not.toBeNull();
  });
});
