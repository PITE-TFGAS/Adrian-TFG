
// supabase-client.js
// Supabase client initialization
// REQUIRED: Replace these values with your Supabase project credentials

const SUPABASE_URL = 'https://lluevoivlcduqclydzce.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs';

if (SUPABASE_URL !== 'https://lluevoivlcduqclydzce.supabase.co' || SUPABASE_KEY !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsdWV2b2l2bGNkdXFjbHlkemNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzNDA1ODEsImV4cCI6MjA4NTkxNjU4MX0.MDvrtjgopH9D6YhRhbo85J9-eJvV0q3N2NktQuH6VXs') {
  console.error('⚠️ MISSING SUPABASE CREDENTIALS. Please edit supabase-client.js');
  alert('⚠️ INCOMPLETE CONFIGURATION: Please open supabase-client.js and add your Supabase URL and Key.');
}

// Initialize the client (assuming supabase.min.js has loaded "supabase" in window)
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
if (supabaseClient) window.supabaseClient = supabaseClient; // EXPOSE GLOBALLY

if (!supabaseClient) {
  console.error('Error: The Supabase library has not loaded correctly.');
}
