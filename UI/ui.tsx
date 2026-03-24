// UI/ui.tsx
import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdin } from 'ink';
import Gradient from 'ink-gradient';
import Spinner from 'ink-spinner';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import fs from 'fs';


import * as agent from '../agent/index.js';

const marked = new Marked(new markedTerminal());

// --- ASCII Art Header ---
const HEADER_ASCII = `
███████╗███████╗██████╗ ███████╗██████╗ ███████╗██████╗ 
██╔════╝██╔════╝██╔══██╗██╔════╝██╔══██╗██╔════╝██╔══██╗
█████╗  █████╗  ██║  ██║█████╗  ██████╔╝█████╗  ██████╔╝
██╔══╝  ██╔══╝  ██║  ██║██╔══╝  ██╔══██╗██╔══╝  ██╔══██╗
██║     ███████╗██████╔╝███████╗██║  ██║███████╗██║  ██║
╚═╝     ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝
                                                        
`.trim();


const Header = () => {
    const headerLines = HEADER_ASCII.split('\n');
    return (
        <Box flexDirection="column" alignItems="left" paddingBottom={1}>
            <Box flexDirection="column">
                    <Text bold color="#588157">{headerLines[0]}</Text>
                    <Text bold color="#588157">{headerLines[1]}</Text>
                    <Text bold color="#3a5a40">{headerLines[2]}</Text>
                    <Text bold color="#3a5a40">{headerLines[3]}</Text>
                    <Text bold color="#2B4036">{headerLines[4]}</Text>
                    <Text bold color="#2B4036">{headerLines[5]}</Text>
                </Box>
            
            <Box marginTop={1} width={80}>
                <Text color="white" dimColor italic wrap="wrap" textAlign="center">
                    {'Ask anything about tennis.\nFrom serve mechanics and Grand Slam trivia to player rankings and historic rivalries and get back a concise, citation backed answer.'}
                </Text>
            </Box>
        </Box>
    );
};

// Modified ChatHistory to display messages, distinguishing user/agent output.
const ChatHistory = ({ messages }) => (
    <Box flexDirection="column" paddingBottom={1}>
        {messages.map((message, index) => (
            <React.Fragment key={index}>
                {message}
            </React.Fragment>
        ))}
    </Box>
);

// Displays the latest log messages from the agent core.
const LogBox = ({ logMessages }) => {
    if (logMessages.length === 0) {
        return null;
    }
    return (
        <Box flexDirection="column" paddingY={1} width="100%">
            <Text dimColor>--- Agent Logs ---</Text>
            {logMessages.map((msg, index) => (
                <Text key={index} color="gray" dimColor wrap="truncate">
                    {msg}
                </Text>
            ))}
        </Box>
    );
};

const LoadingSpinner = () => (
    <Box>
        <Text color="green">
            <Spinner type="dots" />
            {' Processing...'}
        </Text>
    </Box>
);

// InputBox displays the current input value and a cursor.
const InputBox = ({ value }) => {
    // Basic logic for showing '@' prefix for file suggestions.
    const parts = value.split(/(@\S*)/); 
    return (
        <Box borderStyle="single" paddingX={1} marginBottom={1}>
            <Text>
                {parts.map((part, i) => {
                    if (part.startsWith('@')) {
                        return (
                            <Text key={i} color="red">
                                {part}
                            </Text>
                        );
                    }
                    return part;
                })}
                █
            </Text>
        </Box>
    );
};

// Component to display file suggestions.
const FileSuggestions = ({ suggestions, activeIndex, filterText }) => {
    if (suggestions.length === 0) return null;

    const filteredSuggestions = suggestions
        .filter(s => s.toLowerCase().includes(filterText.toLowerCase()))
        .slice(0, 5);

    if (filteredSuggestions.length === 0) return null;

    return (
        <Box flexDirection="column" borderStyle="single" width="100%" paddingX={1}>
            {filteredSuggestions.map((suggestion, index) => {
                const color = index === activeIndex ? 'red' : 'white';
                return (
                    <Text key={suggestion} color={color}>
                        {suggestion}
                    </Text>
                );
            })}
        </Box>
    );
};

const InteractiveController = ({
    exit,
    isAgentReady,
    suggestions,
    activeIndex,
    suggestionBoxVisible,
    inputValueRef,
    setActiveIndex,
    setInputValue,
    setSuggestionBoxVisible,
    setMessages,
    setIsLoading,
}: {
    exit: () => void;
    isAgentReady: boolean;
    suggestions: string[];
    activeIndex: number;
    suggestionBoxVisible: boolean;
    inputValueRef: React.MutableRefObject<string>;
    setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    setSuggestionBoxVisible: React.Dispatch<React.SetStateAction<boolean>>;
    setMessages: React.Dispatch<React.SetStateAction<React.ReactNode[]>>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
}) => {
    useInput((input, key) => {
        if (key.ctrl && key.name === 'c') {
            exit();
            return;
        }

        if (!isAgentReady && !(key.ctrl && key.name === 'c')) return;

        if (suggestionBoxVisible) {
            if (key.upArrow) {
                setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
            } else if (key.downArrow) {
                setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
            } else if (key.return) {
                const currentInputValue = inputValueRef.current;
                const mentionParts = currentInputValue.split('@');
                let newInputValue = currentInputValue;

                if (mentionParts.length > 0 && currentInputValue.endsWith('@')) {
                    const textAfterAt = mentionParts[mentionParts.length - 1];
                    const beforeMention = currentInputValue.slice(0, -textAfterAt.length);
                    newInputValue = beforeMention + '@' + suggestions[activeIndex] + ' ';
                } else {
                    newInputValue = currentInputValue + suggestions[activeIndex] + ' ';
                }
                setInputValue(newInputValue);
                setSuggestionBoxVisible(false);
                setActiveIndex(0);
            } else if (key.backspace || key.delete) {
                const newValue = inputValueRef.current.slice(0, -1);
                setInputValue(newValue);
                if (!newValue.endsWith('@')) setSuggestionBoxVisible(false);
            } else {
                setInputValue(inputValueRef.current + input);
            }
        } else {
            if (key.return) {
                const submittedInput = inputValueRef.current.trim();
                setInputValue('');

                if (submittedInput === '') return;

                setMessages((prev) => [
                    ...prev,
                    <Text key={`user-${prev.length}`} color="cyan">{`> ${submittedInput}`}</Text>
                ]);

                setIsLoading(true);
                (async () => {
                    let agentResponse = '';
                    try {
                        agentResponse = await agent.handleUserInput(submittedInput);
                    } catch (e: any) {
                        agentResponse = `An unexpected error occurred: ${e.message}`;
                    }
                    setIsLoading(false);
                    const formattedResponse = marked.parse(agentResponse).trim();
                    setMessages((prev) => [
                        ...prev,
                        <Box key={`agent-${prev.length}`} flexDirection="column">
                            <Text color="green">Agent:</Text>
                            <Text>{formattedResponse}</Text>
                        </Box>
                    ]);
                })();
            } else if (key.backspace || key.delete) {
                setInputValue(inputValueRef.current.slice(0, -1));
            } else {
                const newValue = inputValueRef.current + input;
                setInputValue(newValue);
                if (newValue.endsWith('@')) setSuggestionBoxVisible(true);
            }
        }
    });

    return null;
};

const App = () => {
    const { exit } = useApp();
    const { isRawModeSupported } = useStdin();
    const [messages, setMessages] = useState<React.ReactNode[]>([]); 
    const [logMessages, setLogMessages] = useState<string[]>([]);
    const [inputValue, setInputValue] = useState(''); 
    const [suggestions, setSuggestions] = useState<string[]>([]); 
    const [suggestionBoxVisible, setSuggestionBoxVisible] = useState(false); 
    const [activeIndex, setActiveIndex] = useState(0); 
    const [isAgentReady, setIsAgentReady] = useState(false); 
    const [isLoading, setIsLoading] = useState(false);

    const inputValueRef = useRef(inputValue);
    inputValueRef.current = inputValue;

    // --- Agent Initialization Effect ---
    useEffect(() => {
        // Set up the logger to capture agent output in the UI state
        agent.setAgentLogger?.((logMessage: string) => {
            setLogMessages(prevLogs => [...prevLogs, logMessage].slice(-5)); // Keep last 5 logs
        });

        const init = async () => {
            const success = await agent.initializeAgent();
            if (success) {
                setMessages((prev) => [
                    ...prev,
                    <Text key="init-success" color="green">Agent initialized successfully.</Text>
                ]);
                setIsAgentReady(true);
            } else {
                setMessages((prev) => [
                    ...prev,
                    <Text key="init-fail" color="red">Agent failed to initialize. Please check logs.</Text>
                ]);
            }
        };
        init();
    }, []);

    // --- File Suggestion Logic ---
    useEffect(() => {
        if (suggestionBoxVisible) {
            fs.readdir(process.cwd(), (err, files) => {
                if (err) {
                    setSuggestions([]);
                } else {
                    setSuggestions(files.filter(f => !f.startsWith('.') && f !== 'node_modules'));
                }
            });
        } else {
            setSuggestions([]);
            setActiveIndex(0);
        }
    }, [suggestionBoxVisible]);


    return (
        <Box flexDirection="column" width="100%" height="100%">
            <Header />
            <ChatHistory messages={messages} />
            <Box flexGrow={1} />
            {isLoading ? <LoadingSpinner /> : <LogBox logMessages={logMessages} />}
            <InputBox value={inputValue} />
            {isRawModeSupported ? (
                <InteractiveController
                    exit={exit}
                    isAgentReady={isAgentReady}
                    suggestions={suggestions}
                    activeIndex={activeIndex}
                    suggestionBoxVisible={suggestionBoxVisible}
                    inputValueRef={inputValueRef}
                    setActiveIndex={setActiveIndex}
                    setInputValue={setInputValue}
                    setSuggestionBoxVisible={setSuggestionBoxVisible}
                    setMessages={setMessages}
                    setIsLoading={setIsLoading}
                />
            ) : (
                <Text color="yellow" dimColor>
                    Input is disabled (raw mode not supported on this stdin). Run in an interactive terminal.
                </Text>
            )}
            {suggestionBoxVisible && (
                <FileSuggestions 
                    suggestions={suggestions} 
                    activeIndex={activeIndex} 
                    filterText={inputValue.split('@').pop() || ''}
                />
            )}
        </Box>
    );
};

render(<App />);
