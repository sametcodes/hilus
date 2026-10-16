//! Sistem tepsisi: pencere kapatılınca uygulama tepside yaşamaya devam eder.
//! Oturum (parçalar, rapor, Geri al) bellekte kalır; yalnızca "Çık" uygulamayı sonlandırır.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

const TRAY_TEMPLATE: &[u8] = include_bytes!("../icons/tray-template.png");

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Hilus'u göster", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Güncellemeleri denetle", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Çık", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &update, &quit])?;

    let builder = TrayIconBuilder::with_id("hilus")
        .tooltip("Hilus — dikte")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "update" => {
                show_main(app);
                let _ = app.emit("check-updates", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    // macOS menü çubuğunda tek renkli "template" ikon, Windows'ta renkli uygulama ikonu.
    let builder = if cfg!(target_os = "macos") {
        builder
            .icon(Image::from_bytes(TRAY_TEMPLATE)?)
            .icon_as_template(true)
    } else {
        match app.default_window_icon() {
            Some(icon) => builder.icon(icon.clone()),
            None => builder.icon(Image::from_bytes(TRAY_TEMPLATE)?),
        }
    };
    builder.build(app)?;
    Ok(())
}

pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    let _ = app.set_dock_visibility(true);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Kapat düğmesi pencereyi gizler (uygulama tepside kalır).
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
        #[cfg(target_os = "macos")]
        let _ = window.app_handle().set_dock_visibility(false);
    }
}
