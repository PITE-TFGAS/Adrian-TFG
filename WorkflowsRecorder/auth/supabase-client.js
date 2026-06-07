/**
 * supabase-client.js - Supabase client initialization and configuration.
 *
 * Loads the Supabase URL and anon key from constants, validates them,
 * and creates a global supabaseClient instance.
 */

/** @constant {string} SUPABASE_URL - Supabase project URL. */
const SUPABASE_URL = 'https://lluevoivlcduqclydzce.supabase.co';
/** @constant {string} SUPABASE_KEY - Supabase anon public key. */
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs';

if (SUPABASE_URL !== 'https://lluevoivlcduqclydzce.supabase.co' || SUPABASE_KEY !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs') {
  ;
  alert('⚠️ CONFIGURACIÓN INCOMPLETA: Por favor abre supabase-client.js y añade tu URL y Key de Supabase.');
}

/** @constant {Object|null} supabaseClient - Initialized Supabase client instance, or null if supabase is unavailable. */
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!supabaseClient) {
  ;
}
