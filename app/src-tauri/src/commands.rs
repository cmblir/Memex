// Tauri IPC command surface. Each function is a thin adapter that delegates
// to a domain module (vault, parser, index). Keep this file free of business
// logic so the same modules remain unit-testable without Tauri runtime.

use crate::index::{self, Adjacency};
use crate::parser;
use crate::vault::{self, FileContent, FileNode, VaultMeta};

#[tauri::command]
pub fn open_vault(path: String) -> Result<VaultMeta, String> {
    vault::open_vault(&path)
}

#[tauri::command]
pub fn list_files(root: String) -> Result<Vec<FileNode>, String> {
    vault::list_files(&root)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    vault::read_file(&path)
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    vault::write_file(&path, &content)
}

#[tauri::command]
pub fn create_file(parent: String, name: String) -> Result<String, String> {
    vault::create_file(&parent, &name)
}

#[tauri::command]
pub fn create_folder(parent: String, name: String) -> Result<String, String> {
    vault::create_folder(&parent, &name)
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    vault::delete_path(&path)
}

#[tauri::command]
pub fn rename_path(from: String, to_name: String) -> Result<String, String> {
    vault::rename_path(&from, &to_name)
}

#[tauri::command]
pub fn parse_links(path: String) -> Result<Vec<String>, String> {
    parser::parse_links(&path)
}

#[tauri::command]
pub fn build_link_graph(root: String) -> Result<Adjacency, String> {
    index::build_link_graph(&root)
}
