/**
 * storage-utils.js - chrome.storage.local wrapper for workflow persistence.
 *
 * Provides CRUD operations, search, import/export, and statistics
 * for workflows stored in the browser's local storage.
 */

/**
 * Loads all workflows from local storage.
 *
 * Reads the workflow index list, then fetches each workflow's data by key.
 *
 * @returns {Promise<Array<Object>>} Array of workflow objects with attached data.
 */
async function loadAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];

    if (workflowList.length === 0) {
      ;
      return [];
    }

    ;

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
    ;

    return validWorkflows;

  } catch (error) {
    ;
    return [];
  }
}

/**
 * Loads a single workflow by its unique identifier.
 *
 * @param {string} id - Workflow identifier.
 * @returns {Promise<Object|null>} The workflow data, or null if not found.
 */
async function loadWorkflowById(id) {
  try {
    const workflowKey = `workflow_${id}`;
    const result = await chrome.storage.local.get([workflowKey]);

    if (result[workflowKey]) {
      ;
      return result[workflowKey];
    } else {
      ;
      return null;
    }
  } catch (error) {
    ;
    return null;
  }
}

/**
 * Deletes a workflow by its unique identifier.
 *
 * Removes both the index entry and the workflow data from storage.
 *
 * @param {string} id - Workflow identifier to delete.
 * @returns {Promise<boolean>} True if deletion succeeded, false otherwise.
 */
async function deleteWorkflow(id) {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];
    const updatedList = workflowList.filter(w => w.id !== id);
    await chrome.storage.local.set({ workflowList: updatedList });

    const workflowKey = `workflow_${id}`;
    await chrome.storage.local.remove([workflowKey]);

    ;
    return true;
  } catch (error) {
    ;
    return false;
  }
}

/**
 * Finds workflows whose URL matches the given URL.
 *
 * Performs flexible matching: exact match, substring inclusion in both directions.
 *
 * @param {string} url - URL to search for.
 * @returns {Promise<Array<Object>>} Matching workflow objects.
 */
async function findWorkflowsByUrl(url) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const matches = allWorkflows.filter(w => {
      return w.url === url || w.url.includes(url) || url.includes(w.url);
    });

    ;
    return matches;
  } catch (error) {
    ;
    return [];
  }
}

/**
 * Searches workflows by name (case-insensitive substring match).
 *
 * @param {string} searchTerm - Term to search for in workflow names.
 * @returns {Promise<Array<Object>>} Matching workflow objects.
 */
async function searchWorkflowsByName(searchTerm) {
  try {
    const allWorkflows = await loadAllWorkflows();
    const term = searchTerm.toLowerCase();
    const matches = allWorkflows.filter(w =>
      w.name.toLowerCase().includes(term)
    );

    ;
    return matches;
  } catch (error) {
    ;
    return [];
  }
}

/**
 * Computes aggregate statistics across all stored workflows.
 *
 * @returns {Promise<Object|null>} Stats object with total, totalSteps, urls, oldest, newest, or null on failure.
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

    ;
    return stats;
  } catch (error) {
    ;
    return null;
  }
}

/**
 * Removes all workflows from local storage.
 *
 * Clears both the index list and all individual workflow data keys.
 *
 * @returns {Promise<boolean>} True if clearing succeeded, false otherwise.
 */
async function clearAllWorkflows() {
  try {
    const result = await chrome.storage.local.get(['workflowList']);
    const workflowList = result.workflowList || [];

    for (const item of workflowList) {
      const workflowKey = `workflow_${item.id}`;
      await chrome.storage.local.remove([workflowKey]);
    }

    await chrome.storage.local.set({ workflowList: [] });

    ;
    return true;
  } catch (error) {
    ;
    return false;
  }
}

/**
 * Exports all workflows as a JSON string.
 *
 * @returns {Promise<string|null>} JSON string of all workflows, or null on failure.
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
    ;
    return null;
  }
}

/**
 * Imports workflows from a JSON string.
 *
 * Parses the import data and persists each workflow into local storage.
 *
 * @param {string} jsonString - JSON string containing workflows to import.
 * @returns {Promise<number>} Number of successfully imported workflows.
 */
async function importWorkflows(jsonString) {
  try {
    const importData = JSON.parse(jsonString);
    const workflows = importData.workflows || [];

    let imported = 0;

    for (const workflowData of workflows) {
      const filename = `workflow-${workflowData.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.json`;

      const result = await chrome.storage.local.get(['workflowList']);
      const workflowList = result.workflowList || [];

      workflowList.push({
        id: filename,
        filename: filename,
        name: workflowData.name,
        url: workflowData.url,
        createdAt: workflowData.createdAt,
        stepsCount: workflowData.drawflow.nodes.length
      });

      await chrome.storage.local.set({ workflowList });
      const workflowKey = `workflow_${filename}`;
      await chrome.storage.local.set({ [workflowKey]: workflowData });

      imported++;
    }

    ;
    return imported;
  } catch (error) {
    ;
    return 0;
  }
}

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
