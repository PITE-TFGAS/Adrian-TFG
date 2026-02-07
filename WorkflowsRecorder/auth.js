
// auth.js
// Gestión de autenticación con Supabase

const AuthManager = {
  // Iniciar sesión
  async login(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });
    return { data, error };
  },

  // Registrarse
  async register(email, password) {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { data, error } = await supabaseClient.auth.signUp({
      email: email,
      password: password
    });
    return { data, error };
  },

  // Cerrar sesión
  async logout() {
    if (!supabaseClient) return { error: { message: "Supabase no inicializado" } };

    const { error } = await supabaseClient.auth.signOut();
    return { error };
  },

  // Obtener usuario actual
  async getCurrentUser() {
    if (!supabaseClient) return null;

    const { data: { session } } = await supabaseClient.auth.getSession();
    return session ? session.user : null;
  },

  // Escuchar cambios de estado
  onAuthStateChange(callback) {
    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }
};
