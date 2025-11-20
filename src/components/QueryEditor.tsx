/**
 * Query Editor Component
 * 
 * An expandable, resizable text input for SQL queries.
 * Auto-expands to fit content up to 5 lines, then scrolls.
 * Allows drag-to-resize for more space.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    View,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    Text,
    Platform,
} from 'react-native';

export interface QueryEditorProps {
    value: string;
    onChangeText: (text: string) => void;
    onExecute: () => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    showExpandButton?: boolean;
    onExpand?: () => void;
    showCollapseButton?: boolean;
    onCollapse?: () => void;
}

export default function QueryEditor({
    value,
    onChangeText,
    onExecute,
    placeholder = 'Enter SQL query...',
    disabled = false,
    loading = false,
    showExpandButton = false,
    onExpand,
    showCollapseButton = false,
    onCollapse,
}: QueryEditorProps) {
    const [height, setHeight] = useState(40); // Initial height for single line
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartY, setResizeStartY] = useState(0);
    const [resizeStartHeight, setResizeStartHeight] = useState(40);
    const inputRef = useRef<TextInput>(null);
    const domElementRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
    const handlerRef = useRef<((e: Event) => void) | null>(null);
    const valueRef = useRef(value);
    const disabledRef = useRef(disabled);
    const loadingRef = useRef(loading);
    const onExecuteRef = useRef(onExecute);
    
    // Keep refs in sync
    useEffect(() => {
        valueRef.current = value;
        disabledRef.current = disabled;
        loadingRef.current = loading;
        onExecuteRef.current = onExecute;
    }, [value, disabled, loading, onExecute]);
    const minHeight = 40;
    const maxAutoHeight = 120; // ~5 lines at 24px line height
    const maxManualHeight = 400;

    // Calculate auto height based on content
    const calculateAutoHeight = useCallback((text: string): number => {
        const lineCount = (text.match(/\n/g) || []).length + 1;
        const lineHeight = 24; // Approximate line height
        const padding = 16; // Top and bottom padding
        const calculatedHeight = lineCount * lineHeight + padding;
        return Math.min(Math.max(calculatedHeight, minHeight), maxAutoHeight);
    }, []);

    // Update height when value changes (auto-expand)
    useEffect(() => {
        if (!isResizing && height < maxAutoHeight) {
            const newHeight = calculateAutoHeight(value);
            setHeight(newHeight);
        }
    }, [value, calculateAutoHeight, isResizing, height]);

    // Handle resize start (web)
    const handleResizeStart = useCallback((e: any) => {
        if (Platform.OS !== 'web') return;
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        const clientY = e.clientY || e.nativeEvent?.clientY || 0;
        setResizeStartY(clientY);
        setResizeStartHeight(height);
    }, [height]);

    // Handle resize move (web)
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;
            const diff = resizeStartY - e.clientY; // Inverted because we're resizing from bottom
            const newHeight = Math.min(
                Math.max(resizeStartHeight + diff, minHeight),
                maxManualHeight
            );
            setHeight(newHeight);
        };

        const handleMouseUp = () => {
            if (isResizing) {
                setIsResizing(false);
            }
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, resizeStartY, resizeStartHeight]);

    // Set up ref callback to capture DOM element directly
    const setInputRef = useCallback((node: TextInput | null) => {
        inputRef.current = node;
        
        if (Platform.OS === 'web' && node) {
            // Try to get the underlying DOM element
            const nodeAny = node as any;
            const findDOMElement = (): HTMLTextAreaElement | HTMLInputElement | null => {
                // Try various ways React Native Web exposes the DOM node
                let domNode = nodeAny._node || 
                             nodeAny._nativeNode || 
                             nodeAny._internalFiberInstanceHandleDEV?.stateNode ||
                             (nodeAny.setNativeProps ? nodeAny : null);
                
                // If it's already a textarea/input, return it
                if (domNode && (domNode.tagName === 'TEXTAREA' || domNode.tagName === 'INPUT')) {
                    return domNode;
                }
                
                // Try to find textarea/input inside
                if (domNode && typeof domNode.querySelector === 'function') {
                    return domNode.querySelector('textarea') || domNode.querySelector('input');
                }
                
                return null;
            };
            
            // Remove old listener if it exists
            if (domElementRef.current && handlerRef.current) {
                domElementRef.current.removeEventListener('keydown', handlerRef.current, true);
                handlerRef.current = null;
            }
            
            // Try immediately and with a small delay
            const tryAttach = () => {
                const domEl = findDOMElement();
                if (domEl) {
                    // Remove old listener if switching elements
                    if (domElementRef.current && domElementRef.current !== domEl && handlerRef.current) {
                        domElementRef.current.removeEventListener('keydown', handlerRef.current, true);
                    }
                    
                    domElementRef.current = domEl;
                    
                    // Create new handler that uses refs for latest values
                    const handleKeyDown = (e: Event) => {
                        const keyEvent = e as KeyboardEvent;
                        // Enter without Shift: submit query
                        if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
                            keyEvent.preventDefault();
                            keyEvent.stopPropagation();
                            if (valueRef.current.trim() && !disabledRef.current && !loadingRef.current) {
                                onExecuteRef.current();
                            }
                            return;
                        }
                        // Cmd/Ctrl + Enter: also submit
                        if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key === 'Enter') {
                            keyEvent.preventDefault();
                            keyEvent.stopPropagation();
                            if (valueRef.current.trim() && !disabledRef.current && !loadingRef.current) {
                                onExecuteRef.current();
                            }
                        }
                    };
                    
                    handlerRef.current = handleKeyDown;
                    domEl.addEventListener('keydown', handleKeyDown, true);
                }
            };
            
            tryAttach();
            setTimeout(tryAttach, 50);
            setTimeout(tryAttach, 200);
        }
    }, []); // Only run once when ref is set, handler uses refs for values

    // Clean up event listener when component unmounts
    useEffect(() => {
        return () => {
            if (domElementRef.current && handlerRef.current) {
                domElementRef.current.removeEventListener('keydown', handlerRef.current, true);
                domElementRef.current = null;
                handlerRef.current = null;
            }
        };
    }, []);

    return (
        <View style={styles.container}>
            {showExpandButton && onExpand && (
                <TouchableOpacity
                    style={styles.expandButton}
                    onPress={onExpand}
                >
                    <Text style={styles.expandButtonIcon}>☰</Text>
                </TouchableOpacity>
            )}
            {showCollapseButton && onCollapse && (
                <TouchableOpacity
                    style={styles.expandButton}
                    onPress={onCollapse}
                >
                    <Text style={styles.expandButtonIcon}>◀</Text>
                </TouchableOpacity>
            )}
            <View 
                style={styles.inputContainer}
                {...(Platform.OS === 'web' ? {
                    onKeyDown: (e: any) => {
                        const event = e.nativeEvent || e;
                        // Enter without Shift: submit query
                        if (event.key === 'Enter' && !event.shiftKey) {
                            e.preventDefault?.();
                            if (value.trim() && !disabled && !loading) {
                                onExecute();
                            }
                        }
                        // Cmd/Ctrl + Enter: also submit
                        else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            e.preventDefault?.();
                            if (value.trim() && !disabled && !loading) {
                                onExecute();
                            }
                        }
                    }
                } : {})}
            >
                <TextInput
                    ref={setInputRef}
                    style={[
                        styles.input,
                        { height: Math.max(height, minHeight) },
                        disabled && styles.inputDisabled,
                    ]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor="#999"
                    multiline
                    textAlignVertical="top"
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!disabled}
                    scrollEnabled={height >= maxAutoHeight}
                />
                {Platform.OS === 'web' && (
                    <View
                        style={[
                            styles.resizeHandle,
                            isResizing && styles.resizeHandleActive,
                        ]}
                        onMouseDown={handleResizeStart}
                    />
                )}
            </View>
            <TouchableOpacity
                style={[styles.executeButton, (disabled || !value.trim() || loading) && styles.executeButtonDisabled]}
                onPress={onExecute}
                disabled={disabled || !value.trim() || loading}
            >
                {loading ? (
                    <Text style={styles.executeButtonText}>...</Text>
                ) : (
                    <Text style={styles.executeButtonText}>Run</Text>
                )}
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
        backgroundColor: '#fafafa',
    },
    expandButton: {
        padding: 8,
        justifyContent: 'center',
        alignItems: 'center',
        minWidth: 36,
        height: 40,
    },
    expandButtonIcon: {
        fontSize: 18,
        color: '#667eea',
        fontWeight: '600',
    },
    inputContainer: {
        flex: 1,
        position: 'relative',
    },
    input: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 6,
        padding: 8,
        fontSize: 14,
        fontFamily: 'monospace',
        backgroundColor: '#fff',
        minHeight: 40,
        maxHeight: 400,
    },
    inputDisabled: {
        backgroundColor: '#f5f5f5',
        opacity: 0.6,
    },
    resizeHandle: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 20,
        height: 8,
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        borderTopLeftRadius: 4,
        cursor: 'ns-resize',
        zIndex: 10,
    },
    resizeHandleActive: {
        backgroundColor: '#667eea',
        opacity: 0.6,
    },
    executeButton: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        backgroundColor: '#667eea',
        borderRadius: 6,
        minWidth: 80,
        alignItems: 'center',
        justifyContent: 'center',
        height: 40,
    },
    executeButtonDisabled: {
        backgroundColor: '#ccc',
        opacity: 0.6,
    },
    executeButtonText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});

