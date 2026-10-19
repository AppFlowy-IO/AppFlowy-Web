export { signInWithUrl, verifyToken, getServerInfo, getAuthProviders } from '../js-services/http/auth-api';
export { getUserAuthInfo, type GoTrueUserAuthInfo } from '../js-services/http/gotrue';
export {
  loginAuth as login,
  signInGoogleWithRedirect as signInGoogle,
  signInAppleWithRedirect as signInApple,
  signInGithubWithRedirect as signInGithub,
  signInDiscordWithRedirect as signInDiscord,
  signInSamlWithRedirect as signInSaml,
  signInCustomProviderWithRedirect as signInCustomProvider,
  signInWithLdapWithRedirect as signInLdap,
  signInWithPasswordWithRedirect as signInWithPassword,
  signUpWithPasswordWithRedirect as signUpWithPassword,
  forgotPassword,
  changePassword,
  signInMagicLinkWithRedirect as signInMagicLink,
  signInOTPWithRedirect as signInOTP,
} from '../js-services/cached-api';
