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

// Web-specific div component
const WebDiv = Platform.OS === 'web' ? 'div' : View;

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
    initialRows?: number; // Initial number of rows from URL
    onHeightChange?: (rows: number) => void; // Callback when height changes (rows)
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
    initialRows = 0,
    onHeightChange,
}: QueryEditorProps) {
    // Default height matches sidebar header (65px), can expand in row increments
    const HEADER_HEIGHT = 64; // Matches sidebar databaseDropdownRow minHeight
    const ROW_HEIGHT = 36; // Approximate row height for snapping
    const [containerHeight, setContainerHeight] = useState(HEADER_HEIGHT + initialRows * ROW_HEIGHT);
    const [isResizing, setIsResizing] = useState(false);
    const resizeStartYRef = useRef(0);
    const resizeStartHeightRef = useRef(HEADER_HEIGHT + initialRows * ROW_HEIGHT);
    const inputRef = useRef<TextInput>(null);
    const domElementRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
    const resizeHandleRef = useRef<View | null>(null);
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
    const minHeight = HEADER_HEIGHT; // Minimum is header height
    const maxManualHeight = HEADER_HEIGHT + (ROW_HEIGHT * 10); // Allow up to 10 rows

    // Calculate textarea height based on content (within container)
    const calculateTextareaHeight = useCallback((text: string): number => {
        if (!text || text.trim() === '') return 40;
        const lineCount = (text.match(/\n/g) || []).length + 1;
        const lineHeight = 24; // Approximate line height
        const padding = 16; // Top and bottom padding
        const calculatedHeight = lineCount * lineHeight + padding;
        // Textarea height should fit within container, but can expand container if needed
        return Math.max(calculatedHeight, 40);
    }, []);

    // Calculate textarea height based on content
    const [textareaHeight, setTextareaHeight] = useState(40);
    
    // Update textarea height when value changes (but don't change container height unless needed)
    useEffect(() => {
        if (!isResizing) {
            // On web, use scrollHeight for accurate height
            if (Platform.OS === 'web' && domElementRef.current) {
                const domEl = domElementRef.current as any;
                if (domEl && typeof domEl.scrollHeight !== 'undefined') {
                    // Reset height to auto to get accurate scrollHeight
                    domEl.style.height = 'auto';
                    const scrollHeight = domEl.scrollHeight;
                    // Set textarea height
                    domEl.style.height = `${scrollHeight}px`;
                    domEl.style.overflow = 'hidden';
                    domEl.style.maxHeight = 'none';
                    setTextareaHeight(scrollHeight);
                    
                    // If textarea needs more space than container, expand container to next row increment
                    const containerPadding = 24; // 12px top + 12px bottom
                    const neededHeight = scrollHeight + containerPadding;
                    if (neededHeight > containerHeight) {
                        // Snap to next row increment
                        const rowsNeeded = Math.ceil((neededHeight - HEADER_HEIGHT) / ROW_HEIGHT);
                        const snappedHeight = HEADER_HEIGHT + (rowsNeeded * ROW_HEIGHT);
                        setContainerHeight(snappedHeight);
                    }
                    return;
                }
            }
            
            // Fallback to calculated height
            const newHeight = calculateTextareaHeight(value);
            setTextareaHeight(newHeight);
            
            // Check if container needs to expand
            const containerPadding = 24;
            const neededHeight = newHeight + containerPadding;
            if (neededHeight > containerHeight && !isResizing) {
                const rowsNeeded = Math.ceil((neededHeight - HEADER_HEIGHT) / ROW_HEIGHT);
                const snappedHeight = HEADER_HEIGHT + (rowsNeeded * ROW_HEIGHT);
                setContainerHeight(snappedHeight);
            }
        }
    }, [value, calculateTextareaHeight, isResizing, containerHeight]);

    // Handle resize start (web) - resize the container
    const handleResizeStart = useCallback((e: any) => {
        if (Platform.OS !== 'web') return;
        console.log('[QueryEditor] Resize start', e);
        e.preventDefault();
        e.stopPropagation();
        const clientY = e.clientY || e.nativeEvent?.clientY || 0;
        resizeStartYRef.current = clientY;
        resizeStartHeightRef.current = containerHeight;
        console.log('[QueryEditor] Starting resize at Y:', clientY, 'current height:', containerHeight);
        setIsResizing(true);
    }, [containerHeight]);

    // Handle resize move (web) - snap to row increments
    useEffect(() => {
        if (Platform.OS !== 'web') return;
        const doc = typeof (global as any).document !== 'undefined' ? (global as any).document : null;
        if (!doc) return;

        const handleMouseMove = (e: any) => {
            if (!isResizing) return;
            const clientY = e.clientY || 0;
            // When dragging down (clientY increases), diff should be positive to increase height
            const diff = clientY - resizeStartYRef.current;
            const rawHeight = resizeStartHeightRef.current + diff;
            
            // Snap to row increments
            const rows = Math.round((rawHeight - HEADER_HEIGHT) / ROW_HEIGHT);
            const snappedHeight = HEADER_HEIGHT + (rows * ROW_HEIGHT);
            
            const newHeight = Math.min(
                Math.max(snappedHeight, minHeight),
                maxManualHeight
            );
            console.log('[QueryEditor] Mouse move - Y:', clientY, 'startY:', resizeStartYRef.current, 'diff:', diff, 'rawHeight:', rawHeight, 'rows:', rows, 'snappedHeight:', snappedHeight, 'new height:', newHeight);
            setContainerHeight(newHeight);
            
            // Update URL if rows changed and callback is provided
            if (onHeightChange && rows >= 0) {
                onHeightChange(rows);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            doc.addEventListener('mousemove', handleMouseMove);
            doc.addEventListener('mouseup', handleMouseUp);
            
            return () => {
                doc.removeEventListener('mousemove', handleMouseMove);
                doc.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, minHeight, maxManualHeight]);

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
                    
                    // Directly set overflow style to prevent scrolling and allow expansion
                    const domElAny = domEl as any;
                    if (domElAny && typeof domElAny.scrollHeight !== 'undefined') {
                        // Remove any max-height constraints from textarea
                        domElAny.style.overflow = 'hidden';
                        domElAny.style.maxHeight = 'none';
                        domElAny.style.resize = 'none';
                        // Set initial height based on scrollHeight
                        domElAny.style.height = 'auto';
                        domElAny.style.height = `${domElAny.scrollHeight}px`;
                        
                        // Also remove constraints from parent container
                        let parent = domElAny.parentElement;
                        let depth = 0;
                        while (parent && depth < 5) {
                            const parentAny = parent as any;
                            parentAny.style.maxHeight = 'none';
                            parentAny.style.overflow = 'visible';
                            parent = parent.parentElement;
                            depth++;
                        }
                        
                        // Update height when content changes
                        const updateHeight = () => {
                            if (domElAny && typeof domElAny.scrollHeight !== 'undefined') {
                                domElAny.style.height = 'auto';
                                domElAny.style.height = `${domElAny.scrollHeight}px`;
                                setTextareaHeight(domElAny.scrollHeight);
                                
                                // Check if container needs to expand
                                const containerPadding = 24;
                                const neededHeight = domElAny.scrollHeight + containerPadding;
                                if (neededHeight > containerHeight) {
                                    const rowsNeeded = Math.ceil((neededHeight - HEADER_HEIGHT) / ROW_HEIGHT);
                                    const snappedHeight = HEADER_HEIGHT + (rowsNeeded * ROW_HEIGHT);
                                    setContainerHeight(snappedHeight);
                                }
                            }
                        };
                        domElAny.addEventListener('input', updateHeight);
                    }
                    
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


    console.log('[QueryEditor] Rendering with containerHeight:', containerHeight);
    
    return (
        <View 
            style={[styles.container, { height: containerHeight }]}
        >
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
                style={[styles.inputContainer, { maxHeight: undefined }]}
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
                        { height: textareaHeight },
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
                    scrollEnabled={false}
                />
            </View>
            {Platform.OS === 'web' ? React.createElement('div', {
                ref: resizeHandleRef as any,
                style: {
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 12,
                    backgroundColor: isResizing ? 'rgba(102, 126, 234, 0.2)' : 'transparent',
                    cursor: 'ns-resize',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                },
                onMouseDown: (e: any) => {
                    console.log('[QueryEditor] Div mousedown!', e);
                    e.preventDefault();
                    e.stopPropagation();
                    const clientY = e.clientY || 0;
                    resizeStartYRef.current = clientY;
                    resizeStartHeightRef.current = containerHeight;
                    console.log('[QueryEditor] Setting isResizing to true, Y:', clientY, 'height:', containerHeight);
                    setIsResizing(true);
                },
            }, React.createElement('div', {
                style: {
                    width: 40,
                    height: 4,
                    backgroundColor: isResizing ? '#667eea' : 'rgba(102, 126, 234, 0.3)',
                    borderRadius: 2,
                }
            })) : null}
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
        position: 'relative',
        overflow: 'visible',
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
    },
    inputDisabled: {
        backgroundColor: '#f5f5f5',
        opacity: 0.6,
    },
    resizeHandle: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 12,
        backgroundColor: 'transparent',
        cursor: 'ns-resize',
        zIndex: 10,
        alignItems: 'center',
        justifyContent: 'center',
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

