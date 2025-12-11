// Mock for lodash-es module
const isEqual = jest.fn((a: any, b: any) => true);

const debounce = jest.fn((func: Function, wait?: number) => {
  const debouncedFn = jest.fn((...args: any[]) => {
    return func(...args);
  });

  debouncedFn.cancel = jest.fn();
  debouncedFn.flush = jest.fn(() => func());

  return debouncedFn;
});

const some = <T>(arr: T[], predicate: (v: T) => boolean) => arr.some(predicate);
const every = <T>(arr: T[], predicate: (v: T) => boolean) => arr.every(predicate);
const filter = <T>(arr: T[], predicate: (v: T) => boolean) => arr.filter(predicate);

export default isEqual;
export { isEqual, debounce, some, every, filter };
