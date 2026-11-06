import { imageLink, imageName, imageURL } from '../image-data';

it.each([
  'javascript:alert(1)',
  'data:image/png;base64,abc',
  'file:///private/image.png',
  'https://user:password@example.com/image',
  'invalid',
])('rejects unsafe image source %s', (value) => {
  expect(imageURL(value)).toBeUndefined();
  expect(imageLink(JSON.stringify({ url: value }))).toBeUndefined();
});
it('retains safe remote and Flutter page links and tolerates malformed legacy data', () => {
  expect(imageURL(' https://example.com/my image.png ')).toBe('https://example.com/my%20image.png');
  expect(imageLink(JSON.stringify({ is_page_link: true, page_id: 'page' }))).toMatchObject({
    is_page_link: true,
    page_id: 'page',
  });
  expect(
    imageLink(JSON.stringify({ is_page_link: true, page_id: 'page', url: 'https://app.example.com/app/ws/page' }))
  ).toEqual({ is_page_link: true, page_id: 'page', url: 'https://app.example.com/app/ws/page' });
  for (const value of ['{', 'null', '{}', '[]']) expect(imageLink(value)).toBeUndefined();
  expect(imageName({ name: 'My picture', url: 'https://example.com/photo.png' })).toBe('My picture');
  expect(imageName({ url: 'https://example.com/Ocean%20view.png' })).toBe('Ocean view.png');
});
