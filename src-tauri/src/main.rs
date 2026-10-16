// Windows'ta release derlemede ek konsol penceresi açılmasın.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hilus_lib::run()
}
