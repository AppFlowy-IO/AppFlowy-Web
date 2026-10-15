import { PlainError } from '@/application/errors/plain-error';
import { getErrorMessage } from '@/utils/errors';

describe('PlainError', () => {
  it("shows this client's translated copy through the shared renderer", () => {
    const copy = "Your administrator hasn't allowed you to create workspaces.";

    expect(getErrorMessage(new PlainError(copy))).toBe(copy);
  });

  it('keeps raw error text out of the interface', () => {
    expect(getErrorMessage(new Error('Cannot read properties of undefined (reading "id")'))).toBe(
      'Something went wrong. Contact support if this keeps happening.'
    );
  });

  it('keeps the message, name and cause for checks and logs', () => {
    const cause = { code: -1, message: 'Network Error' };
    const error = new PlainError("We couldn't confirm that the workspace was created.", { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("We couldn't confirm that the workspace was created.");
    expect(error.cause).toBe(cause);
    expect(error.name).toBe('PlainError');
  });
});
