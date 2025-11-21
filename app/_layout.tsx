import React from "react";
import { Stack } from 'expo-router';

// Note: We don't import xp-schema here because it contains Node.js-specific code
// that won't work in React Native. Individual pages will import what they need.

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen 
        name="index" 
        options={{ 
          title: 'Database Test',
          headerShown: false
        }} 
      />
      <Stack.Screen 
        name="db-browser"
        options={{ 
          title: 'Database Browser',
          headerShown: false
        }} 
      />
      <Stack.Screen 
        name="db-browser/[db]/[table]" 
        options={{ 
          headerShown: false,
          title: ''
        }} 
      />
        <Stack.Screen
            name="db-browser/[db]/index"
            options={{
                headerShown: false,
                title: ''
            }}
        />
    </Stack>
  );
}
