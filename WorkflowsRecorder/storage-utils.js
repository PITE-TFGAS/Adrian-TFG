// storage-utils.js - Utilities to handle workflows in Chrome Storage

/**
 * Load all saved workflows
 * @returns {Promise<Array>} Array of workflows with their data
 */
async function loadAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];

    if (workflowList.length === 0) {
      console.log('No workflows saved');
      return [];
    }

    console.log(`📚 Loading ${workflowList.length} workflow(s)...`);

    // Load full data for each workflow
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
    console.log(`✓ ${validWorkflows.length} workflow(s) loaded successfully`);

    return validWorkflows;

  } catch (error) {
    console.error('Error loading workflows:', error);
    return [];
  }
}

/**
 * Load a specific workflow by ID
 * @param {string} id - Workflow ID
 * @returns {Promise<Object|null>} Workflow data or null
 */
async function loadWorkflowById(id) {
  try {
    const workflowKey = `workflow_${id}`;
    const result = await chrome.storage.local.get([workflowKey]);

    if (result[workflowKey]) {
      console.log('✓ Workflow loaded:', id);
      return result[workflowKey];
    } else {
      console.warn('⚠️ Workflow not found:', id);
      return null;
    }
  } catch (error) {
    console.error('Error loading workflow:', error);
    return null;
  }
}

/**
 * Delete a workflow
 * @param {string} id - ID of the workflow to delete
 * @returns {Promise<boolean>} true if deleted successfully
 */
async function deleteWorkflow(id) {
  try {
    // Delete from list
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];
    const updatedList = workflowList.filter(w => w.id !== id);
    await chrome.storage.local.set({ workflowList: updatedList });

    // Delete workflow data
    const workflowKey = `workflow_${id}`;
    await chrome.storage.local.remove([workflowKey]);

    console.log('✓ Workflow deleted:', id);
    return true;
  } catch (error) {
    console.error('Error deleting workflow:', error);
    return false;
  }
}

/**
 * Find workflows by URL
 * @param {string} url - Full or partial URL
 * @returns {Promise<Array>} Array of matching workflows
 */
async function findWorkflowsByUrl(url) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const matches = allWorkflows.filter(w => {
      // Exact or partial comparison
      return w.url === url || w.url.includes(url) || url.includes(w.url);
    });

    console.log(`🔍 Found ${matches.length} workflow(s) for URL: ${url}`);
    return matches;
  } catch (error) {
    console.error('Error searching workflows:', error);
    return [];
  }
}

/**
 * Search workflows by name
 * @param {string} searchTerm - Search term
 * @returns {Promise<Array>} Array of matching workflows
 */
async function searchWorkflowsByName(searchTerm) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const term = searchTerm.toLowerCase();
    const matches = allWorkflows.filter(w =>
      w.name.toLowerCase().includes(term)
    );

    console.log(`🔍 Found ${matches.length} workflow(s) with: "${searchTerm}"`);
    return matches;
  } catch (error) {
    console.error('Error searching workflows:', error);
    return [];
  }
}

/**
 * Get workflow statistics
 * @returns {Promise<Object>} Object with statistics
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

    console.log('📊 Workflow statistics:', stats);
    return stats;
  } catch (error) {
    console.error('Error getting statistics:', error);
    return null;
  }
}

/**
 * Clear all workflows
 * @returns {Promise<boolean>} true if cleared successfully
 */
async function clearAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];

    // Delete each workflow
    for (const item of workflowList) {
      const workflowKey = `workflow_${item.id}`;
      await chrome.storage.local.remove([workflowKey]);
    }

    // Clear list
    await chrome.storage.local.set({ workflowList: [] });

    console.log('✓ All workflows deleted');
    return true;
  } catch (error) {
    console.error('Error clearing workflows:', error);
    return false;
  }
}

/**
 * Export all workflows to JSON
 * @returns {Promise<string>} JSON with all workflows
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
    console.error('Error exporting workflows:', error);
    return null;
  }
}

/**
 * Import workflows from JSON
 * @param {string} jsonString - JSON with workflows to import
 * @returns {Promise<number>} Number of imported workflows
 */
async function importWorkflows(jsonString) {
  try {
    const importData = JSON.parse(jsonString);
    const workflows = importData.workflows || [];

    let imported = 0;

    for (const workflowData of workflows) {
      const filename = `workflow-${workflowData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;

      // Get current list
      const result = await chrome.storage.local.get(['workflowList']);
      const workflowList = result.workflowList || [];

      // Add metadata
      workflowList.push({
        id: filename,
        filename: filename,
        name: workflowData.name,
        url: workflowData.url,
        createdAt: workflowData.createdAt,
        stepsCount: workflowData.drawflow.nodes.length
      });

      // Save
      await chrome.storage.local.set({ workflowList });
      const workflowKey = `workflow_${filename}`;
      await chrome.storage.local.set({ [workflowKey]: workflowData });

      imported++;
    }

    console.log(`✓ ${imported} workflow(s) imported`);
    return imported;
  } catch (error) {
    console.error('Error importing workflows:', error);
    return 0;
  }
}

// If in a module, export functions
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