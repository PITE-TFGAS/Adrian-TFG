// auth.js
// Authentication management with Supabase

const AuthManager = {
  // Log in
  async login(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase not initialized" } };

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    return { data, error };
  },

  // Register
  async register(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase not initialized" } };

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password
    });
    return { data, error };
  },

  // Log out
  async logout() {
    if (!supabaseClient) return { error: { message: "Supabase not initialized" } };

    const { error } = await supabaseClient.auth.signOut();
    return { error };
  },

  // Get current user
  async getCurrentUser() {
    if (!supabaseClient) return null;

    const { data: { session } } = await supabaseClient.auth.getSession();
    return session ? session.user : null;
  },

  // Listen for state changes
  onAuthStateChange(callback) {
    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
};
