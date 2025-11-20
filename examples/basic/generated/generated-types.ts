/**
 * Generated Type Declarations
 * 
 * This file is auto-generated. Do not edit manually.
 * 
 * Generated at: 2025-11-20T20:13:40.988Z
 */

/**
 * UsersTableRecord - Record type for users table
 */
export type UsersTableRecord = {
  id: string;
  name: string | null;
  birthday: Date;
  gender: "male" | "female" | null;
  bio: string | null;
  headline: string | null;
  metadata: any;
};

/**
 * UsersTableInsert - Insert type for users table
 */
export type UsersTableInsert = {
  name?: string | null;
  gender?: "male" | "female" | null;
  bio?: string | null;
  headline?: string | null;
  metadata?: any;
  id: string;
  birthday: Date;
};

/**
 * PostsTableRecord - Record type for posts table
 */
export type PostsTableRecord = {
  id: string;
  author: string;
  postedAt: Date;
  content: string | null;
};

/**
 * PostsTableInsert - Insert type for posts table
 */
export type PostsTableInsert = {
  content?: string | null;
  id: string;
  author: string;
  postedAt: Date;
};

