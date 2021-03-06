imports.gi.versions.Gtk = '3.0';
imports.gi.versions.Gdk = '3.0';

const { Gio, Gtk, GLib, Gdk, Vte } = imports.gi;
const ByteArray = imports.byteArray;
const Local = imports.misc.extensionUtils.getCurrentExtension();
const { SettingLabel } = Local.imports.prefs_shared;
const Helper = Local.imports.helper;
const Settings = Helper.getSettings(Local.path, Local.metadata['settings-schema']);
const Temp = Local.imports.temp;
const shared = Local.imports.shared.module.exports;
const Gettext = imports.gettext.domain(Local.metadata['gettext-domain']);
const _ = Gettext.gettext;
const devicesPath = Local.path + '/config/devices.json';
const nodePath = (GLib.find_program_in_path('nodejs') || GLib.find_program_in_path('node'));
const npmPath = GLib.find_program_in_path('npm');
const fileManagers = ['nautilus', 'nemo'];

let nodeDir;
let nodeBin;

function init()
{
	Helper.initTranslations(Local.path, Local.metadata['gettext-domain']);
}

class MissingNotification extends Gtk.VBox
{
	constructor(dependName)
	{
		super({height_request: 380, spacing: 10, margin: 20});
		let label = null;

		label = new Gtk.Label({
			/* TRANSLATORS: Will contain dependency name at the beginning (e.g. Node.js is not installed) */
			label: '<span font="16"><b>' + dependName + " " + _("is not installed") + '</b></span>',
			use_markup: true,
			vexpand: true,
			valign: Gtk.Align.CENTER
		});
		this.pack_start(label, true, true, 0);
		this.show_all();
	}
}

class StreamingNotification extends Gtk.VBox
{
	constructor()
	{
		super({height_request: 420, spacing: 10, margin: 20});
		let label = null;

		label = new Gtk.Label({
			label: '<span font="16"><b>' + _("Streaming in progress") + '</b></span>',
			use_markup: true,
			vexpand: true,
			valign: Gtk.Align.END,
			margin_top: 20
		});
		this.pack_start(label, true, true, 0);

		label = new Gtk.Label({
			/* TRANSLATORS: Keep line this short (otherwise extension prefs will strech) */
			label: '<span font="13">' + _("Stop media transfer before accessing extension settings") + '</span>',
			use_markup: true,
			vexpand: true,
			valign: Gtk.Align.START,
			margin_bottom: 30
		});
		this.pack_start(label, true, true, 0);

		let remoteWidget = new RemoteSettings();
		this.pack_start(remoteWidget, true, true, 0);
	}
}

class MainSettings extends Gtk.VBox
{
	constructor()
	{
		super();
		let label = null;
		let widget = null;
		let button = null;
		let box = null;

		let grid = new Gtk.Grid({
			margin: 20,
			row_spacing: 6
		});
		this.pack_start(grid, false, false, 0);

		/* Label: Main Options */
		label = new SettingLabel(_("Main Options"), true);
		grid.attach(label, 0, 0, 1, 1);

		/* Receiver Type */
		label = new SettingLabel(_("Receiver type"));
		widget = new Gtk.ComboBoxText({width_request: 220, halign:Gtk.Align.END});
		widget.append('chromecast', "Chromecast");
		/* TRANSLATORS: "Playercast" is a name of an app, so do not change it */
		widget.append('playercast', _("Playercast app"));
		/* TRANSLATORS: Web browser or Media player app selection. This should be as short as possible e.g. "Browser | Player". */
		widget.append('other', _("Web browser | Media player"));
		Settings.bind('receiver-type', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
		grid.attach(label, 0, 1, 1, 1);
		grid.attach(widget, 1, 1, 1, 1);

		/* FFmpeg Path */
		label = new SettingLabel(_("FFmpeg path"));
		widget = new Gtk.Entry({width_request: 220, halign:Gtk.Align.END});
		widget.set_placeholder_text("/usr/bin/ffmpeg");
		Settings.bind('ffmpeg-path', widget, 'text', Gio.SettingsBindFlags.DEFAULT);
		grid.attach(label, 0, 2, 1, 1);
		grid.attach(widget, 1, 2, 1, 1);

		/* FFprobe Path */
		label = new SettingLabel(_("FFprobe path"));
		widget = new Gtk.Entry({width_request: 220, halign:Gtk.Align.END});
		widget.set_placeholder_text("/usr/bin/ffprobe");
		Settings.bind('ffprobe-path', widget, 'text', Gio.SettingsBindFlags.DEFAULT);
		grid.attach(label, 0, 3, 1, 1);
		grid.attach(widget, 1, 3, 1, 1);

		/* Listening Port */
		label = new SettingLabel(_("Listening port"));
		this.portWidget = new Gtk.SpinButton({halign:Gtk.Align.END});
		this.portWidget.set_sensitive(true);
		this.portWidget.set_range(1, 65535);
		this.portWidget.set_value(Settings.get_int('listening-port'));
		this.portWidget.set_increments(1, 2);
		Settings.bind('listening-port', this.portWidget, 'value', Gio.SettingsBindFlags.DEFAULT);
		grid.attach(label, 0, 4, 1, 1);
		grid.attach(this.portWidget, 1, 4, 1, 1);

		/* Web player link */
		this.linkButton = new Gtk.LinkButton({
			expand: false,
			halign:Gtk.Align.CENTER
		});

		this.hostIp = getHostIp();

		this.updateLink = () =>
		{
			let link = 'http://' + this.hostIp + ':' + this.portWidget.value;
			this.linkButton.uri = link;
			this.linkButton.label = link;
		}

		box = new Gtk.VBox({
			margin: 5,
			hexpand: true,
			valign:Gtk.Align.END,
			halign:Gtk.Align.CENTER
		});

		this.infoLabel = new Gtk.Label();

		if(this.hostIp)
		{
			this.infoLabel.label = _("Access web player from devices on local network");
			this.updateLink();
		}

		box.pack_start(this.infoLabel, false, false, 0);
		box.pack_start(this.linkButton, false, false, 0);
		this.pack_end(box, false, false, 0);

		this.linkSignal = this.portWidget.connect('value-changed', () => this.updateLink());

		this.checkService = () =>
		{
			let serviceEnabled = Settings.get_boolean('service-enabled');

			if(serviceEnabled && this.hostIp)
			{
				this.infoLabel.show();
				this.linkButton.show();
			}
			else
			{
				this.infoLabel.hide();
				this.linkButton.hide();
			}
		}

		this.serviceSignal = Settings.connect('changed::service-enabled', () => this.checkService());
	}

	destroy()
	{
		Settings.disconnect(this.serviceSignal);
		this.portWidget.disconnect(this.linkSignal);

		super.destroy();
	}
}

class RemoteSettings extends Gtk.Grid
{
	constructor()
	{
		super({margin: 20, row_spacing: 6});
		let label = null;
		let widget = null;

		/* Label: Remote Controller */
		label = new SettingLabel(_("Remote Controller"), true);
		this.attach(label, 0, 0, 1, 1);

		/* Remote Position */
		label = new SettingLabel(_("Remote position"));
		widget = new Gtk.ComboBoxText({halign:Gtk.Align.END});
		widget.append('left', _("Left"));
		widget.append('center-left', _("Center (left side)"));
		widget.append('center-right', _("Center (right side)"));
		widget.append('right', _("Right"));
		Settings.bind('remote-position', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 1, 1, 1);
		this.attach(widget, 1, 1, 1, 1);

		/* Seek Backward/Forward */
		label = new SettingLabel(_("Seek backward/forward (seconds)"));
		widget = new Gtk.SpinButton({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_range(1, 120);
		widget.set_value(Settings.get_int('seek-time'));
		widget.set_increments(1, 2);
		Settings.bind('seek-time', widget, 'value', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 2, 1, 1);
		this.attach(widget, 1, 2, 1, 1);

		/* Media Buttons Size */
		label = new SettingLabel(_("Media control buttons size"));
		widget = new Gtk.SpinButton({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_range(8, 32);
		widget.set_value(Settings.get_int('media-buttons-size'));
		widget.set_increments(1, 2);
		Settings.bind('media-buttons-size', widget, 'value', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 3, 1, 1);
		this.attach(widget, 1, 3, 1, 1);

		/* Slider Icon Size */
		label = new SettingLabel(_("Slider icon size"));
		widget = new Gtk.SpinButton({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_range(8, 32);
		widget.set_value(Settings.get_int('slider-icon-size'));
		widget.set_increments(1, 2);
		Settings.bind('slider-icon-size', widget, 'value', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 4, 1, 1);
		this.attach(widget, 1, 4, 1, 1);

		/* Volume Slider */
		label = new SettingLabel(_("Unify sliders"));
		widget = new Gtk.Switch({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_active(Settings.get_boolean('unified-slider'));
		Settings.bind('unified-slider', widget, 'active', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 5, 1, 1);
		this.attach(widget, 1, 5, 1, 1);

		/* Remote Label */
		label = new SettingLabel(_("Show remote label"));
		widget = new Gtk.Switch({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_active(Settings.get_boolean('remote-label'));
		Settings.bind('remote-label', widget, 'active', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 6, 1, 1);
		this.attach(widget, 1, 6, 1, 1);
	}

	destroy()
	{
		super.destroy();
	}
}

class ChromecastSettings extends Gtk.Grid
{
	constructor()
	{
		super({margin: 20, row_spacing: 6});
		let label = null;
		let widget = null;
		let box = null;
		let button = null;
		let rgba = new Gdk.RGBA();

		let subsConfig = Temp.readFromFile(Local.path + '/config/subtitles.json');
		if(!subsConfig)
		{
			subsConfig = shared.chromecast.subsStyle;
			GLib.mkdir_with_parents(Local.path + '/config', 509); // 775 in octal
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		}

		/* Label: Chromecast Options */
		label = new SettingLabel(_("Chromecast Options"), true);
		this.attach(label, 0, 0, 1, 1);

		/* Chromecast device name */
		label = new SettingLabel(_("Device selection"));
		box = new Gtk.HBox({halign:Gtk.Align.END});
		widget = new Gtk.ComboBoxText();
		this.scanButton = Gtk.Button.new_from_icon_name('view-refresh-symbolic', 4);
		box.pack_end(this.scanButton, false, false, 0);
		box.pack_end(widget, false, false, 8);
		setDevices(widget);
		this.scanSignal = this.scanButton.connect('clicked', scanDevices.bind(this, widget, this.scanButton));
		Settings.bind('chromecast-name', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 1, 1, 1);
		this.attach(box, 1, 1, 1, 1);

		/* Label: Subtitles */
		label = new SettingLabel(_("Subtitles"), true, true);
		this.attach(label, 0, 2, 1, 1);

		/* Font Family */
		label = new SettingLabel(_("Font family"));
		this.fontFamily = new Gtk.ComboBoxText({halign:Gtk.Align.END});
		this.fontFamily.append('SANS_SERIF', "Droid Sans");
		this.fontFamily.append('MONOSPACED_SANS_SERIF', "Droid Sans Mono");
		this.fontFamily.append('SERIF', "Droid Serif Regular");
		this.fontFamily.append('MONOSPACED_SERIF', "Cutive Mono");
		this.fontFamily.append('CASUAL', "Short Stack");
		this.fontFamily.append('CURSIVE', "Quintessential");
		this.fontFamily.append('SMALL_CAPITALS', "Alegreya Sans SC");
		this.fontFamily.active_id = subsConfig.fontGenericFamily;
		this.familySignal = this.fontFamily.connect('changed', () =>
		{
			subsConfig.fontFamily = this.fontFamily.get_active_text();
			subsConfig.fontGenericFamily = this.fontFamily.active_id;
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		this.attach(label, 0, 3, 1, 1);
		this.attach(this.fontFamily, 1, 3, 1, 1);

		/* Font Style */
		label = new SettingLabel(_("Font style"));
		this.fontStyle = new Gtk.ComboBoxText({halign:Gtk.Align.END});
		this.fontStyle.append('NORMAL', _("Normal"));
		this.fontStyle.append('BOLD', _("Bold"));
		this.fontStyle.append('ITALIC', _("Italic"));
		this.fontStyle.append('BOLD_ITALIC', _("Bold italic"));
		this.fontStyle.active_id = subsConfig.fontStyle;
		this.styleSignal = this.fontStyle.connect('changed', () =>
		{
			subsConfig.fontStyle = this.fontStyle.active_id;
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		this.attach(label, 0, 4, 1, 1);
		this.attach(this.fontStyle, 1, 4, 1, 1);

		/* Subtitles Scale */
		label = new SettingLabel(_("Scale factor"));
		this.scaleButton = new Gtk.SpinButton({halign:Gtk.Align.END, digits:1});
		this.scaleButton.set_sensitive(true);
		this.scaleButton.set_range(0.1, 5.0);
		this.scaleButton.set_value(subsConfig.fontScale);
		this.scaleButton.set_increments(0.1, 0.2);
		this.scaleSignal = this.scaleButton.connect('value-changed', () =>
		{
			subsConfig.fontScale = this.scaleButton.value.toFixed(1);
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		this.attach(label, 0, 5, 1, 1);
		this.attach(this.scaleButton, 1, 5, 1, 1);

		/* Font Color */
		label = new SettingLabel(_("Font color"));
		rgba.parse(hashToColor(subsConfig.foregroundColor));
		this.fontColor = new Gtk.ColorButton({halign:Gtk.Align.END, rgba: rgba, show_editor: true});
		this.fontColor.set_sensitive(true);
		this.fontColorSignal = this.fontColor.connect('color-set', () =>
		{
			subsConfig.foregroundColor = colorToHash(this.fontColor.rgba.to_string());
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		this.attach(label, 0, 6, 1, 1);
		this.attach(this.fontColor, 1, 6, 1, 1);

		/* Font Outline */
		label = new SettingLabel(_("Font outline"));
		box = new Gtk.HBox({halign:Gtk.Align.END});
		this.outlineSwitch = new Gtk.Switch({halign:Gtk.Align.END, valign:Gtk.Align.CENTER});
		this.outlineSwitch.set_sensitive(true);
		this.checkActive = () =>
		{
			if(subsConfig.edgeType == "OUTLINE") return true;
			else return false;
		}
		this.outlineSwitch.set_active(this.checkActive());
		this.outlineSignal = this.outlineSwitch.connect('notify::active', () =>
		{
			if(this.outlineSwitch.active) subsConfig.edgeType = "OUTLINE";
			else subsConfig.edgeType = "NONE";

			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});

		rgba.parse(hashToColor(subsConfig.edgeColor));
		this.edgeColor = new Gtk.ColorButton({halign:Gtk.Align.END, rgba: rgba, show_editor: true});
		this.edgeColor.set_sensitive(true);
		this.edgeSignal = this.edgeColor.connect('color-set', () =>
		{
			subsConfig.edgeColor = colorToHash(this.edgeColor.rgba.to_string());
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		box.pack_end(this.edgeColor, false, false, 0);
		box.pack_end(this.outlineSwitch, false, false, 8);
		this.attach(label, 0, 7, 1, 1);
		this.attach(box, 1, 7, 1, 1);

		/* Background color */
		label = new SettingLabel(_("Background color"));
		rgba.parse(hashToColor(subsConfig.backgroundColor));
		this.bgColor = new Gtk.ColorButton({halign:Gtk.Align.END, rgba: rgba, show_editor: true, use_alpha: true});
		this.bgColor.set_sensitive(true);
		this.bgSignal = this.bgColor.connect('color-set', () =>
		{
			subsConfig.backgroundColor = colorToHash(this.bgColor.rgba.to_string());
			Temp.writeToFile(Local.path + '/config/subtitles.json', subsConfig);
		});
		this.attach(label, 0, 8, 1, 1);
		this.attach(this.bgColor, 1, 8, 1, 1);
	}

	destroy()
	{
		this.scanButton.disconnect(this.scanSignal);
		this.fontFamily.disconnect(this.familySignal);
		this.fontStyle.disconnect(this.styleSignal);
		this.scaleButton.disconnect(this.scaleSignal);
		this.fontColor.disconnect(this.fontColorSignal);
		this.outlineSignal.disconnect(this.outlineSignal);
		this.edgeColor.disconnect(this.edgeSignal);
		this.bgColor.disconnect(this.bgSignal);

		super.destroy();
	}
}

class OtherSettings extends Gtk.Grid
{
	constructor()
	{
		super({margin: 20, row_spacing: 6});
		let label = null;
		let widget = null;

		/* Label: Media Encoding */
		label = new SettingLabel(_("Media Encoding"), true);
		this.attach(label, 0, 0, 1, 1);

		/* Hardware Acceleration */
		label = new SettingLabel(_("Hardware acceleration"));
		widget = new Gtk.ComboBoxText({halign:Gtk.Align.END});
		widget.append('none', _("None"));
		/* TRANSLATORS: Should remain as VAAPI unless you use different alphabet */
		widget.append('vaapi', _("VAAPI"));
		/* TRANSLATORS: Should remain as NVENC unless you use different alphabet */
		widget.append('nvenc', _("NVENC"));
		Settings.bind('video-acceleration', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 1, 1, 1);
		this.attach(widget, 1, 1, 1, 1);

		/* Video Bitrate */
		label = new SettingLabel(_("Bitrate (Mbps)"));
		widget = new Gtk.SpinButton({halign:Gtk.Align.END, digits:1});
		widget.set_sensitive(true);
		widget.set_range(2.0, 10.0);
		widget.set_value(Settings.get_double('video-bitrate'));
		widget.set_increments(0.1, 0.2);
		Settings.bind('video-bitrate', widget, 'value', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 2, 1, 1);
		this.attach(widget, 1, 2, 1, 1);

		/* Label: Web Player */
		label = new SettingLabel(_("Web Player"), true, true);
		this.attach(label, 0, 3, 1, 1);

		/* Subtitles Scale */
		label = new SettingLabel(_("Subtitles scale factor"));
		widget = new Gtk.SpinButton({halign:Gtk.Align.END, digits:1});
		widget.set_sensitive(true);
		widget.set_range(0.1, 5.0);
		widget.set_value(Settings.get_double('webplayer-subs'));
		widget.set_increments(0.1, 0.2);
		Settings.bind('webplayer-subs', widget, 'value', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 4, 1, 1);
		this.attach(widget, 1, 4, 1, 1);

		/* Label: Playercast */
		label = new SettingLabel(_("Playercast app"), true, true);
		this.attach(label, 0, 5, 1, 1);

		/* Playercast device name */
		label = new SettingLabel(_("Device selection"));
		widget = new Gtk.ComboBoxText();
		setDevices(widget, shared.playercastsPath);
		Settings.bind('playercast-name', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
		let currentPlayercast = Settings.get_string('playercast-name');
		if(widget.active_id != currentPlayercast)
		{
			widget.append(currentPlayercast, currentPlayercast);
			widget.active_id = currentPlayercast;
		}
		this.attach(label, 0, 6, 1, 1);
		this.attach(widget, 1, 6, 1, 1);

		/* Label: Miscellaneous */
		/* TRANSLATORS: The rest of extension settings */
		label = new SettingLabel(_("Miscellaneous"), true, true);
		this.attach(label, 0, 7, 1, 1);

		/* Music Visualizer */
		label = new SettingLabel(_("Music visualizer"));
		widget = new Gtk.Switch({halign:Gtk.Align.END});
		widget.set_sensitive(true);
		widget.set_active(Settings.get_boolean('music-visualizer'));
		Settings.bind('music-visualizer', widget, 'active', Gio.SettingsBindFlags.DEFAULT);
		this.attach(label, 0, 8, 1, 1);
		this.attach(widget, 1, 8, 1, 1);

		/* Nautilus/Nemo Integration */
		label = new SettingLabel(_("Nautilus/Nemo integration"));
		this.nautilusSwitch = new Gtk.Switch({halign:Gtk.Align.END});
		this.nautilusSwitch.set_sensitive(true);

		let isFmExtEnabled = () =>
		{
			let homeDir = GLib.get_home_dir();
			if(!homeDir) return false;

			for(var fm of fileManagers)
			{
				if(GLib.file_test(homeDir + '/.local/share/' + fm +
					'-python/extensions/nautilus-cast-to-tv.py', 16)
				) {
					return true;
				}
			}

			return false;
		}

		this.nautilusSwitch.set_active(isFmExtEnabled());

		this.nautilusSignal = this.nautilusSwitch.connect('notify::active', () =>
		{
			enableNautilusExtension(this.nautilusSwitch.active);
		});

		this.attach(label, 0, 9, 1, 1);
		this.attach(this.nautilusSwitch, 1, 9, 1, 1);
	}

	destroy()
	{
		this.nautilusSwitch.disconnect(this.nautilusSignal);

		super.destroy();
	}
}

class AddonsSettings extends Gtk.Notebook
{
	constructor()
	{
		super();
		let label = null;

		let extPath = Local.path.substring(0, Local.path.lastIndexOf('/'));
		let extDir = Gio.File.new_for_path(extPath);
		let dirEnum = extDir.enumerate_children('standard::name,standard::type', 0, null);
		let addons = [];

		let info;
		while((info = dirEnum.next_file(null)))
		{
			let dirName = info.get_name();

			if(dirName.includes('cast-to-tv') && dirName.includes('addon'))
			{
				addons.push(dirName);
			}
		}

		addons.sort();
		addons.forEach(addonDir =>
		{
			let addonPath = extPath + '/' + addonDir;
			let addonName = addonDir.substring(11, addonDir.lastIndexOf('-'));
			let isPrefs = GLib.file_test(addonPath + '/' + addonName + '_prefs.js', 16);

			if(isPrefs)
			{
				imports.searchPath.unshift(addonPath);
				let addonPrefs = imports[addonName + '_prefs'];

				addonPrefs.init();
				let widget = addonPrefs.buildPrefsWidget();
				this.append_page(widget, widget.title);
			}
		});

		imports.searchPath.unshift(extPath);
	}

	destroy()
	{
		super.destroy();
	}
}

class ModulesSettings extends Gtk.VBox
{
	constructor()
	{
		super({margin: 10});

		let TermWidget = new Vte.Terminal({
			height_request: 320,
			scroll_on_output: true,
			margin_bottom: 10
		});

		let background = new Gdk.RGBA({red: 0.96, green: 0.96, blue: 0.96, alpha: 1});
		let foreground = new Gdk.RGBA({red: 0, green: 0, blue: 0, alpha: 1});

		TermWidget.set_color_background(background);
		TermWidget.set_color_foreground(foreground);
		TermWidget.set_color_cursor(background);
		TermWidget.set_cursor_shape(Vte.CursorShape.IBEAM);
		TermWidget.set_cursor_blink_mode(Vte.CursorBlinkMode.OFF);
		TermWidget.set_sensitive(false);

		this.pack_start(TermWidget, true, true, 0);
		let installLabel = _("Install npm modules");

		this.installButton = new Gtk.Button({
			label: _(installLabel),
			expand: false,
			halign: Gtk.Align.CENTER
		});
		this.pack_start(this.installButton, false, false, 0);

		let installCallback = () =>
		{
			if(Settings.get_boolean('service-wanted'))
				GLib.spawn_async('/usr/bin', ['gjs', Local.path + '/server-monitor.js'], null, 0, null);

			this.installButton.label = _(installLabel);
			this.installButton.set_sensitive(true);
		}

		let installModules = () =>
		{
			TermWidget.reset(true, true);
			/* Stops both server and monitor service */
			GLib.spawn_command_line_sync('pkill -SIGINT -f ' + Local.path);
			this.installButton.set_sensitive(false);
			this.installButton.label = _("Installing...");

			try {
				TermWidget.spawn_async(
					Vte.PtyFlags.DEFAULT, Local.path, [npmPath, 'install'],
					null, 0, null, null, null, 120000, null, () => installCallback());
			}
			catch(err) {
				let [res, pid] = TermWidget.spawn_sync(
					Vte.PtyFlags.DEFAULT, Local.path, [npmPath, 'install'],
					null, GLib.SpawnFlags.DO_NOT_REAP_CHILD, null, null);

				GLib.child_watch_add(GLib.PRIORITY_LOW, pid, () => installCallback());
			}
		}

		this.installSignal = this.installButton.connect('clicked', installModules.bind(this));
	}

	destroy()
	{
		this.installButton.disconnect(this.installSignal);

		super.destroy();
	}
}

class AboutPage extends Gtk.VBox
{
	constructor()
	{
		super({valign: Gtk.Align.CENTER, halign: Gtk.Align.CENTER});
		let label = null;
		let linkButton = null;

		/* Image */
		let image = new Gtk.Image({
			file: Local.path + '/appIcon/prefs.png',
			margin: 5,
			margin_top: 25
		});
		this.pack_start(image, false, false, 0);

		/* Extension name */
		label = new Gtk.Label({
			label: '<span font="16"><b>' + "Cast to TV" + '</b></span>',
			use_markup: true
		});
		this.pack_start(label, false, false, 0);

		/* Extension version */
		label = new Gtk.Label({
			label: '<span font="12"><b>' + _("version:") + " " + Local.metadata['version'] + '</b></span>',
			use_markup: true
		});
		this.pack_start(label, false, false, 0);

		/* Developer name */
		label = new Gtk.Label({
			label: '<span font="12">' + _("Developed by") + " " + "Rafostar" + '</span>',
			use_markup: true,
			margin: 20
		});
		this.pack_start(label, false, false, 0);

		/* Homepage link */
		linkButton = new Gtk.LinkButton({
			uri: Local.metadata['url'],
			label: _("Extension Homepage")
		});
		this.pack_start(linkButton, false, false, 0);

		/* Playercast link */
		linkButton = new Gtk.LinkButton({
			uri: 'https://rafostar.github.io/playercast',
			label: _("Playercast Homepage")
		});
		this.pack_start(linkButton, false, false, 0);

		/* Donation link */
		linkButton = new Gtk.LinkButton({
			uri: 'https://www.paypal.me/Rafostar',
			label: _("Donate")
		});
		this.pack_start(linkButton, false, false, 20);
	}

	destroy()
	{
		super.destroy();
	}
}

class CastNotebook extends Gtk.Notebook
{
	constructor()
	{
		super({margin: 5});
		let label = null;

		this.mainWidget = new MainSettings();
		label = new Gtk.Label({ label: _("Main") });
		this.append_page(this.mainWidget, label);

		this.remoteWidget = new RemoteSettings();
		label = new Gtk.Label({ label: _("Remote") });
		this.append_page(this.remoteWidget, label);

		this.chromecastWidget = new ChromecastSettings();
		label = new Gtk.Label({ label: "Chromecast" });
		this.append_page(this.chromecastWidget, label);

		this.otherWidget = new OtherSettings();
		/* TRANSLATORS: Other extension settings */
		label = new Gtk.Label({ label: _("Other") });
		this.append_page(this.otherWidget, label);

		this.addonsWidget = new AddonsSettings();
		let addonsNumber = this.addonsWidget.get_n_pages();

		if(addonsNumber == 0) {
			this.addonsWidget.destroy();
			this.addonsWidget = null;
		}
		else {
			label = new Gtk.Label({ label: _("Add-ons") });
			this.append_page(this.addonsWidget, label);
		}

		this.modulesWidget = new ModulesSettings();
		label = new Gtk.Label({ label: _("Modules") });
		this.append_page(this.modulesWidget, label);

		this.aboutWidget = new AboutPage();
		label = new Gtk.Label({ label: _("About") });
		this.append_page(this.aboutWidget, label);
	}

	destroy()
	{
		this.mainWidget.destroy();
		this.otherWidget.destroy();
		this.remoteWidget.destroy();
		this.chromecastWidget.destroy();
		this.modulesWidget.destroy();
		this.aboutWidget.destroy();
		if(this.addonsWidget) this.addonsWidget.destroy();

		super.destroy();
	}
}

class CastToTvSettings extends Gtk.VBox
{
	constructor()
	{
		super();

		this.notebook = new CastNotebook();
		this.pack_start(this.notebook, true, true, 0);

		this.notification = new StreamingNotification();
		this.pack_start(this.notification, true, true, 0);

		this.streamingSignal = Settings.connect('changed::chromecast-playing', () =>
		{
			let chromecastPlaying = Settings.get_boolean('chromecast-playing');

			if(chromecastPlaying)
			{
				this.notebook.hide();
				this.notification.show();
			}
			else
			{
				this.notification.hide();
				this.notebook.show();
			}
		});
	}

	destroy()
	{
		Settings.disconnect(this.streamingSignal);

		this.notebook.destroy();
		this.notification.destroy();

		super.destroy();
	}
}

function scanDevices(widget, button)
{
	button.set_sensitive(false);

	widget.remove_all();
	/* TRANSLATORS: Shown when scan for Chromecast devices is running */
	widget.append('', _("Scanning..."));
	/* Show Scanning label */
	widget.set_active(0);

	GLib.mkdir_with_parents(Local.path + '/config', 509); // 775 in octal

	let [res, pid] = GLib.spawn_async(
		nodeDir, [nodeBin, Local.path + '/node_scripts/utils/scanner'],
		null, GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);

	GLib.child_watch_add(GLib.PRIORITY_LOW, pid, () =>
	{
		setDevices(widget);
		/* Set Automatic as active */
		widget.set_active(0);
		button.set_sensitive(true);
	});
}

function setDevices(widget, filePath)
{
	widget.remove_all();
	widget.append('', _("Automatic"));

	filePath = (typeof filePath === 'string') ? filePath: devicesPath;
	let devices = Temp.readFromFile(filePath);
	if(Array.isArray(devices))
	{
		devices.forEach(device =>
		{
			let value = (device.name) ? device.name : device;
			let text = (device.friendlyName) ? device.friendlyName : device;
			widget.append(value, text);
		});
	}
}

function getHostIp()
{
	try {
		let ip4;

		/* synchronous because must be obtained before widget is shown */
		let [res, stdout] = GLib.spawn_sync(
			nodeDir, [nodeBin, Local.path + '/node_scripts/utils/local-ip'],
			null, 0, null);

		if(res && stdout)
		{
			if(stdout instanceof Uint8Array) ip4 = ByteArray.toString(stdout);
			else ip4 = stdout.toString();

			return ip4.replace(/\n/, '');
		}
		else
		{
			return null;
		}
	}
	catch(err) {
		return null;
	}
}

function enableNautilusExtension(enabled)
{
	let userDataDir = GLib.get_user_data_dir();
	let srcPath = Local.path + '/nautilus/nautilus-cast-to-tv.py';

	if((enabled && !GLib.file_test(srcPath, 16)) || !userDataDir) return;

	fileManagers.forEach(fm =>
	{
		let installPath = userDataDir + '/' + fm + '-python/extensions';
		let destFile = Gio.File.new_for_path(installPath).get_child('nautilus-cast-to-tv.py');

		if(enabled && GLib.find_program_in_path(fm) && !destFile.query_exists(null))
		{
			GLib.mkdir_with_parents(installPath, 493); // 755 in octal
			destFile.make_symbolic_link(Local.path + '/nautilus/nautilus-cast-to-tv.py', null);
		}
		else if(!enabled && destFile.query_exists(null))
		{
			destFile.delete(null);
		}
	});
}

function hashToColor(colorHash)
{
	let colorValue = colorHash.split('#')[1];
	let colorInt = parseInt(colorValue, 16);

	let array = new Uint8Array(4);
	array[3] = colorInt;
	array[2] = colorInt >> 8;
	array[1] = colorInt >> 16;
	array[0] = colorInt >> 24;

	return 'rgba(' + array[0] + ',' + array[1] + ',' + array[2] + ',' + array[3] / 255 + ')';
}

function colorToHash(colorString)
{
	let values = colorString.substring(colorString.indexOf('(') + 1, colorString.indexOf(')')).split(',');
	let hash = "#";

	if(values[3]) values[3] *= 255;

	values.forEach(value =>
	{
		let integer = parseInt(value, 10);
		hash += integer.toString(16).toUpperCase().padStart(2, 0);
	});

	while(hash.length < 9) hash += 'F';

	return hash;
}

function buildPrefsWidget()
{
	let widget = null;

	if(!nodePath) return widget = new MissingNotification('nodejs');
	else if(!npmPath) return widget = new MissingNotification('npm');

	nodeDir = nodePath.substring(0, nodePath.lastIndexOf('/'));
	nodeBin = nodePath.substring(nodePath.lastIndexOf('/') + 1);

	widget = new CastToTvSettings();
	widget.show_all();

	widget.notebook.mainWidget.checkService();

	if(Settings.get_boolean('chromecast-playing')) widget.notebook.hide();
	else widget.notification.hide();

	return widget;
}
