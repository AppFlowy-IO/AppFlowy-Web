import { TFunction } from 'i18next';

interface PasswordValidation {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasSpecialChar: boolean;
}

const validatePassword = (password: string): PasswordValidation => {
  return {
    minLength: password.length >= 6,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
};

export const getPasswordErrors = (password: string, t: TFunction): string[] => {
  const validation = validatePassword(password);
  const errors: string[] = [];

  if (!validation.minLength) {
    errors.push(t('changePassword.passwordError'));
  }

  if (!validation.hasUppercase) {
    errors.push(t('changePassword.passwordErrorUppercase'));
  }

  if (!validation.hasLowercase) {
    errors.push(t('changePassword.passwordErrorLowercase'));
  }

  if (!validation.hasSpecialChar) {
    errors.push(t('changePassword.passwordErrorSpecialChar'));
  }

  return errors;
};
