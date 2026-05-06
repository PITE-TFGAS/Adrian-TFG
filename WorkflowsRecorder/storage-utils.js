// storage-utils.js - Utilidades para manejar workflows en Chrome Storage

/**
 * Cargar todos los workflows guardados
 * @returns {Promise<Array>} Array de workflows con sus datos
 */
async function loadAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];
    
    if (workflowList.length === 0) {
      console.log('No hay workflows guardados');
      return [];
    }
    
    console.log(`📚 Cargando ${workflowList.length} workflow(s)...`);
    
    // Cargar los datos completos de cada workflow
    const workflows = await Promise.all(
      workflowList.map(async (item) => {
        const workflowKey = `workflow_${item.id}`;
        const data = await chrome.storage.local.get([workflowKey]);
        return {
          ...item,
          data: data[workflowKey]
        };
      })
    );
    
    const validWorkflows = workflows.filter(w => w.data);
    console.log(`✓ ${validWorkflows.length} workflow(s) cargados correctamente`);
    
    return validWorkflows;
    
  } catch (error) {
    console.error('Error cargando workflows:', error);
    return [];
  }
}

/**
 * Cargar un workflow específico por ID
 * @param {string} id - ID del workflow
 * @returns {Promise<Object|null>} Datos del workflow o null
 */
async function loadWorkflowById(id) {
  try {
    const workflowKey = `workflow_${id}`;
    const result = await chrome.storage.local.get([workflowKey]);
    
    if (result[workflowKey]) {
      console.log('✓ Workflow cargado:', id);
      return result[workflowKey];
    } else {
      console.warn('⚠️ Workflow no encontrado:', id);
      return null;
    }
  } catch (error) {
    console.error('Error cargando workflow:', error);
    return null;
  }
}

/**
 * Eliminar un workflow
 * @param {string} id - ID del workflow a eliminar
 * @returns {Promise<boolean>} true si se eliminó correctamente
 */
async function deleteWorkflow(id) {
  try {
    // Eliminar de la lista
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];
    const updatedList = workflowList.filter(w => w.id !== id);
    await chrome.storage.local.set({ workflowList: updatedList });
    
    // Eliminar los datos del workflow
    const workflowKey = `workflow_${id}`;
    await chrome.storage.local.remove([workflowKey]);
    
    console.log('✓ Workflow eliminado:', id);
    return true;
  } catch (error) {
    console.error('Error eliminando workflow:', error);
    return false;
  }
}

/**
 * Buscar workflows por URL
 * @param {string} url - URL completa o parcial
 * @returns {Promise<Array>} Array de workflows que coinciden
 */
async function findWorkflowsByUrl(url) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const matches = allWorkflows.filter(w => {
      // Comparación exacta o parcial
      return w.url === url || w.url.includes(url) || url.includes(w.url);
    });
    
    console.log(`🔍 Encontrados ${matches.length} workflow(s) para URL: ${url}`);
    return matches;
  } catch (error) {
    console.error('Error buscando workflows:', error);
    return [];
  }
}

/**
 * Buscar workflows por nombre
 * @param {string} searchTerm - Término de búsqueda
 * @returns {Promise<Array>} Array de workflows que coinciden
 */
async function searchWorkflowsByName(searchTerm) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const term = searchTerm.toLowerCase();
    const matches = allWorkflows.filter(w => 
      w.name.toLowerCase().includes(term)
    );
    
    console.log(`🔍 Encontrados ${matches.length} workflow(s) con: "${searchTerm}"`);
    return matches;
  } catch (error) {
    console.error('Error buscando workflows:', error);
    return [];
  }
}

/**
 * Obtener estadísticas de workflows
 * @returns {Promise<Object>} Objeto con estadísticas
 */
async function getWorkflowStats() {
  try {
    const workflows = await loadAllWorkflows();
    
    const stats = {
      total: workflows.length,
      totalSteps: workflows.reduce((sum, w) => sum + w.stepsCount, 0),
      urls: [...new Set(workflows.map(w => w.url))].length,
      oldest: workflows.length > 0 ? new Date(Math.min(...workflows.map(w => new Date(w.createdAt)))) : null,
      newest: workflows.length > 0 ? new Date(Math.max(...workflows.map(w => new Date(w.createdAt)))) : null
    };
    
    console.log('📊 Estadísticas de workflows:', stats);
    return stats;
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    return null;
  }
}

/**
 * Limpiar todos los workflows
 * @returns {Promise<boolean>} true si se limpiaron correctamente
 */
async function clearAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];
    
    // Eliminar cada workflow
    for (const item of workflowList) {
      const workflowKey = `workflow_${item.id}`;
      await chrome.storage.local.remove([workflowKey]);
    }
    
    // Limpiar la lista
    await chrome.storage.local.set({ workflowList: [] });
    
    console.log('✓ Todos los workflows eliminados');
    return true;
  } catch (error) {
    console.error('Error limpiando workflows:', error);
    return false;
  }
}

/**
 * Exportar todos los workflows a JSON
 * @returns {Promise<string>} JSON con todos los workflows
 */
async function exportAllWorkflows() {
  try {
    const workflows = await loadAllWorkflows();
    const exportData = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      workflows: workflows.map(w => w.data)
    };
    
    return JSON.stringify(exportData, null, 2);
  } catch (error) {
    console.error('Error exportando workflows:', error);
    return null;
  }
}

/**
 * Importar workflows desde JSON
 * @param {string} jsonString - JSON con workflows a importar
 * @returns {Promise<number>} Número de workflows importados
 */
async function importWorkflows(jsonString) {
  try {
    const importData = JSON.parse(jsonString);
    const workflows = importData.workflows || [];
    
    let imported = 0;
    
    for (const workflowData of workflows) {
      const filename = `workflow-${workflowData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;
      
      // Obtener lista actual
      const result = await chrome.storage.local.get(['workflowList']);
      const workflowList = result.workflowList || [];
      
      // Agregar metadata
      workflowList.push({
        id: filename,
        filename: filename,
        name: workflowData.name,
        url: workflowData.url,
        createdAt: workflowData.createdAt,
        stepsCount: workflowData.drawflow.nodes.length
      });
      
      // Guardar
      await chrome.storage.local.set({ workflowList });
      const workflowKey = `workflow_${filename}`;
      await chrome.storage.local.set({ [workflowKey]: workflowData });
      
      imported++;
    }
    
    console.log(`✓ ${imported} workflow(s) importados`);
    return imported;
  } catch (error) {
    console.error('Error importando workflows:', error);
    return 0;
  }
}

// Si estás en un módulo, exporta las funciones
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadAllWorkflows,
    loadWorkflowById,
    deleteWorkflow,
    findWorkflowsByUrl,
    searchWorkflowsByName,
    getWorkflowStats,
    clearAllWorkflows,
    exportAllWorkflows,
    importWorkflows
  };
}