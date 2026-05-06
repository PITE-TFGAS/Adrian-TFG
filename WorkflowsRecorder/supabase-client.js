// supabase-client.js
// Supabase client initialization
// REQUIRED: Replace these values with your Supabase project's credentials

const SUPABASE_URL = 'https://lluevoivlcduqclydzce.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs';

if (SUPABASE_URL !== 'https://lluevoivlcduqclydzce.supabase.co' || SUPABASE_KEY !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs') {
  console.error('⚠️ CREDENCIALES DE SUPABASE FALTANTES. Por favor edita supabase-client.js');
  alert('⚠️ CONFIGURACIÓN INCOMPLETA: Por favor abre supabase-client.js y añade tu URL y Key de Supabase.');
}

// Initialize client (assuming supabase.min.js has loaded "supabase" into window)
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!supabaseClient) {
  console.error('Error: La librería de Supabase no se ha cargado correctamente.');
}
