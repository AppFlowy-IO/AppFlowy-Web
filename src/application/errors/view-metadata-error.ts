/** Local Folder state; API lookup failures keep their original error identity. */
export class ViewMetadataError extends Error {
  constructor(readonly reason: 'not_found' | 'in_trash') {
    super(reason === 'in_trash' ? 'View is in trash' : 'View not found');
    this.name = 'ViewMetadataError';
  }
}
