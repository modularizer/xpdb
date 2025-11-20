import React from 'react';
import { usePathname, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useEffect } from 'react';
import XpDeebyTableView from "../../../src/pages/xp-deeby";
import {NavigateCallback} from "../../../src/components/DatabaseBrowserLayout";

export default function XpDeebyTableViewParent(){
    const pathname = usePathname();
    const searchParams = useLocalSearchParams();
    const lastPathRef = useRef<string | null>(null);
    const isInitialMountRef = useRef(true);

    // Compute current path from pathname and searchParams
    const params = new URLSearchParams();
    Object.keys(searchParams).sort().forEach(key => {
        const value = searchParams[key];
        if (value && typeof value === 'string') {
            params.set(key, value);
        }
    });
    const searchParamsString = params.toString();
    const currentPath = pathname + (searchParamsString ? `?${searchParamsString}` : '');
    const currentPathRef = useRef(currentPath);

    // Update ref when path actually changes
    useEffect(() => {
        if (isInitialMountRef.current) {
            currentPathRef.current = currentPath;
            lastPathRef.current = currentPath;
            isInitialMountRef.current = false;
        } else if (currentPath !== currentPathRef.current) {
            currentPathRef.current = currentPath;
            lastPathRef.current = currentPath;
        }
    }, [pathname, searchParamsString]);

    const handleNavigate: NavigateCallback = useCallback((dbName, tableName, newSearchParams) => {

        const basePath = '/db-browser/';
        let path = basePath;

        if (dbName) {
            path += encodeURIComponent(dbName);
            if (tableName !== null && tableName !== '') {
                // tableName is a valid table name
                path += '/' + encodeURIComponent(tableName);
            } else if (tableName === '') {
                // tableName is empty string (query mode) - add trailing slash
                path += '/';
            }
        }

        const params = new URLSearchParams();
        Object.entries(newSearchParams).forEach(([key, value]) => {
            if (value) {
                params.set(key, value);
            }
        });

        const queryString = params.toString();
        const fullPath = queryString ? `${path}?${queryString}` : path;

        // Compare against the actual current path from ref (which tracks the URL)
        // Use window.history.replaceState to update URL silently without triggering navigation
        //@ts-ignore
        if (fullPath !== currentPathRef.current && typeof window !== 'undefined') {
            currentPathRef.current = fullPath;
            lastPathRef.current = fullPath;
            //@ts-ignore
            window.history.replaceState({}, '', fullPath);
        }
    }, []);

    return <XpDeebyTableView onNavigate={handleNavigate} />
};