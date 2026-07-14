/**
 * Фиксированный bcrypt-hash того же cost (10), что и реальные пароли.
 * Не соответствует паролю ни одного пользователя; генерируется один раз офлайн.
 */
export const LOGIN_DUMMY_BCRYPT_HASH =
  "$2b$10$PFEfoAkHJuc1T.IZkREFnu049n224d6k0eK.cPeT6f5oc1t/GFIRq";
