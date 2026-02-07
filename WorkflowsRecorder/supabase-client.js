
// supabase-client.js
// Inicialización del cliente de Supabase
// REQUERIDO: Reemplaza estos valores con los de tu proyecto de Supabase

const SUPABASE_URL = 'https://lluevoivlcduqclydzce.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs';

if (SUPABASE_URL !== 'https://lluevoivlcduqclydzce.supabase.co' || SUPABASE_KEY !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs') {
  console.error('⚠️ CREDENCIALES DE SUPABASE FALTANTES. Por favor edita supabase-client.js');
  alert('⚠️ CONFIGURACIÓN INCOMPLETA: Por favor abre supabase-client.js y añade tu URL y Key de Supabase.');
}

// Inicializar el cliente (asumiendo que supabase.min.js ha cargado "supabase" en window)
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!supabaseClient) {
  console.error('Error: La librería de Supabase no se ha cargado correctamente.');
}
