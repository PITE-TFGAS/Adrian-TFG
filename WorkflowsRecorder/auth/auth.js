/**
 * auth.js - Supabase authentication (login, register, session management).
 *
 * Provides a singleton AuthManager object wrapping Supabase Auth API calls.
 * All methods check for supabaseClient availability before proceeding.
 */

/** @namespace AuthManager */
const AuthManager = {
  /**
   * Authenticates a user with email and password.
   *
   * @param {string} email - User's email address.
   * @param {string} password - User's password.
   * @returns {Promise<{data: Object|null, error: Object|null>} Auth result or error.
   */
  async login(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    return { data, error };
  },

  /**
   * Registers a new user with email and password.
   *
   * @param {string} email - User's email address.
   * @param {string} password - User's password.
   * @returns {Promise<{data: Object|null, error: Object|null>} Registration result or error.
   */
  async register(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password
    });
    return { data, error };
  },

  /**
   * Signs out the currently authenticated user.
   *
   * @returns {Promise<{error: Object|null>} Logout error if any.
   */
  async logout() {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { error } = await supabaseClient.auth.signOut();
    return { error };
  },

  /**
   * Retrieves the currently authenticated user from the active session.
   *
   * @returns {Promise<Object|null>} The user object, or null if not authenticated.
   */
  async getCurrentUser() {
    if (!supabaseClient) return null;

    const { data: { session } } = await supabaseClient.auth.getSession();
    return session ? session.user : null;
  },

  /**
   * Registers a callback for authentication state changes.
   *
   * @param {Function} callback - Handler receiving (event, session).
   */
  onAuthStateChange(callback) {
    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
};
