const { runAgentCycle } = require('./core/agent-loop');
const { setLogger, log, error } = require('./core/logger');

// --- Initialization ---

/**
 * Sets the logger for the entire agent.
 * This is the entry point for the UI to inject its logging mechanism.
 * @param {function(string): void} loggerFunc - The callback function for logging.
 */
function setAgentLogger(loggerFunc) {
    setLogger(loggerFunc);
}

// This function is intended to be called once when the agent application starts.
async function initializeAgent() {
    try {
        log("Agent core initialized.");
        return true; // Indicate successful initialization
    } catch (e) {
        error("Agent core initialization failed:", e.message);
        return false; 
    }
}

/**
 * Handles user input. It determines if the input is a command
 * or a regular chat message, then invokes the appropriate agent logic.
 * * @param {string} userInput - The raw input string provided by the user from the UI.
 * @returns {Promise<string>} A promise that resolves to the string output to be displayed to the user.
 * This could be an LLM response, command output, or an error message.
 */
async function handleUserInput(userInput) {
    // Trim leading/trailing whitespace from the input for cleaner processing.
    const trimmedInput = userInput.trim();

    // --- Command Handling ---
    // Check if the input starts with a '/' which indicates a command.
    if (trimmedInput.startsWith('/')) {
        // Extract the command name by removing the leading '/'.
        const command = trimmedInput.substring(1); 

        switch (command) {
            // case 'help':
            //     return "Available commands: /help";

            default:
                // If the command is not recognized, inform the user.
                return `Unknown command: /${command}. Type '/help' (not yet implemented) for available commands.`;
        }
    } else {
        // --- Chat Input Handling ---
        // If the input is not a command, treat it as a regular chat message.
        try {
            log(`Agent core: Processing chat input: "${userInput}"`);
            // Call the agent's core cycle to generate an LLM response.
            const llmResponse = await runAgentCycle(userInput);
            return llmResponse;
        } catch (e) {
            // If any part of the agent cycle fails, catch the error.
            error(`Agent core error during chat processing for input "${userInput}":`, e.message);
            // Return a user-friendly error message.
            return `An error occurred while processing your request: ${e.message}`;
        }
    }
}

// Export the functions that the UI will need to interact with the agent.
module.exports = {
    initializeAgent,
    handleUserInput,
    setAgentLogger,
};