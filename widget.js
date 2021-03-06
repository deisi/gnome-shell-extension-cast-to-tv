const { Gio, GLib, St, Clutter } = imports.gi;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Local = imports.misc.extensionUtils.getCurrentExtension();
const Util = imports.misc.util;
const Gettext = imports.gettext.domain(Local.metadata['gettext-domain']);
const _ = Gettext.gettext;
const Temp = Local.imports.temp;
const shared = Local.imports.shared.module.exports;
const extensionsPath = Local.path.substring(0, Local.path.lastIndexOf('/'));
const iconName = 'tv-symbolic';
const maxDelay = 16;
const minDelay = 8;

var isRepeatActive = false;
var isUnifiedSlider = true;
var seekTime = 10;

var statusIcon = new St.Icon({ icon_name: iconName, style_class: 'system-status-icon' });

var castMenu = class CastToTvMenu extends PopupMenu.PopupMenuSection
{
	constructor()
	{
		super();
		this.extensionId = Local.metadata['extension-id'];
		this.castSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Cast Media"), true);
		this.castSubMenu.icon.icon_name = iconName;
		this.isServiceEnabled = true;

		/* Expandable menu */
		this.videoMenuItem = new PopupMenu.PopupImageMenuItem(_("Video"), 'folder-videos-symbolic');
		this.musicMenuItem = new PopupMenu.PopupImageMenuItem(_("Music"), 'folder-music-symbolic');
		this.pictureMenuItem = new PopupMenu.PopupImageMenuItem(_("Picture"), 'folder-pictures-symbolic');
		this.serviceMenuItem = new PopupMenu.PopupMenuItem(_("Turn Off"));
		this.settingsMenuItem = new PopupMenu.PopupMenuItem(_("Cast Settings"));

		/* Assemble all menu items */
		this.castSubMenu.menu.addMenuItem(this.videoMenuItem);
		this.castSubMenu.menu.addMenuItem(this.musicMenuItem);
		this.castSubMenu.menu.addMenuItem(this.pictureMenuItem);
		this.castSubMenu.menu.addMenuItem(this.serviceMenuItem);
		this.castSubMenu.menu.addMenuItem(this.settingsMenuItem);

		/* Signals connections */
		this.videoMenuItem.connect('activate', () => this.spawnFileChooser('VIDEO'));
		this.musicMenuItem.connect('activate', () => this.spawnFileChooser('MUSIC'));
		this.pictureMenuItem.connect('activate', () => this.spawnFileChooser('PICTURE'));
		this.settingsMenuItem.connect('activate', () => this.spawnExtensionPrefs());

		/* Functions */
		this.spawnFileChooser = (streamType) =>
		{
			/* Close other possible opened windows */
			GLib.spawn_command_line_async('pkill -SIGINT -f ' + Local.path + '/file-chooser|' +
				extensionsPath + '/cast-to-tv-.*-addon@rafostar.github.com/app');

			/* To not freeze gnome shell FileChooserDialog needs to be run as separate process */
			GLib.spawn_async('/usr/bin', ['gjs', Local.path + '/file-chooser.js', streamType], null, 0, null);
		}

		this.spawnExtensionPrefs = () =>
		{
			/* Close open window before reopening */
			GLib.spawn_command_line_async('pkill -SIGINT -f gnome-shell-extension-prefs');

			/* Open extension preferences */
			GLib.spawn_async('/usr/bin', ['gnome-shell-extension-prefs',
				'cast-to-tv@rafostar.github.com'], null, 0, null);
		}

		this.enableFullMenu = (enable) =>
		{
			let menuItems = this.castSubMenu.menu._getMenuItems();

			if(enable)
			{
				menuItems.forEach(item => item.actor.show());
				this.serviceMenuItem.label.text = _("Turn Off");
				this.castSubMenu.label.text = _("Cast Media");
			}
			else
			{
				menuItems.forEach(item => item.actor.hide());
				this.serviceMenuItem.actor.show();
				this.settingsMenuItem.actor.show();
				this.serviceMenuItem.label.text = _("Turn On");
				/* TRANSLATORS: When "Cast Media" service is turned off */
				this.castSubMenu.label.text = _("Cast Off");
			}

			this.isServiceEnabled = enable;
		}

		this.addMenuItem(this.castSubMenu);
	}

	destroy()
	{
		super.destroy();
	}
}

var remoteMenu = class CastRemoteMenu extends PanelMenu.Button
{
	constructor()
	{
		super(0.5, _("Chromecast Remote"), false);
		this.mode = 'DIRECT';

		this.box = new St.BoxLayout();
		this.icon = new St.Icon({ icon_name: 'input-dialpad-symbolic', style_class: 'system-status-icon' });
		this.toplabel = new St.Label({ y_expand: true, y_align: Clutter.ActorAlign.CENTER });

		/* Display app icon, label and dropdown arrow */
		this.box.add(this.icon);
		this.box.add(this.toplabel);
		this.box.add(PopupMenu.arrowIcon(St.Side.BOTTOM));

		this.actor.add_child(this.box);

		/* Create base for media control buttons */
		this.popupBase = new PopupBase();

		this.controlsButtonBox = new St.BoxLayout({
			x_align: Clutter.ActorAlign.CENTER,
			x_expand: true
		});

		this.trackTitle = new trackTitleItem();
		this.positionSlider = new SliderItem('folder-videos-symbolic', isUnifiedSlider);
		this.volumeSlider = new SliderItem('audio-volume-high-symbolic', false);
		this.playButton = new MediaControlButton('media-playback-start-symbolic');
		this.pauseButton = new MediaControlButton('media-playback-pause-symbolic');
		this.stopButton = new MediaControlButton('media-playback-stop-symbolic');
		this.seekBackwardButton = new MediaControlButton('media-seek-backward-symbolic');
		this.seekForwardButton = new MediaControlButton('media-seek-forward-symbolic');
		this.skipBackwardButton = new MediaControlButton('media-skip-backward-symbolic');
		this.skipForwardButton = new MediaControlButton('media-skip-forward-symbolic');
		this.repeatButton = new MediaControlButton('media-playlist-repeat-symbolic', true);

		/* Items that might be shown or hidden depending on media content */
		let changableItems = ['positionSlider', 'volumeSlider', 'playButton', 'pauseButton',
			'seekBackwardButton', 'seekForwardButton', 'repeatButton'];

		/* Add space between stop and the remaining buttons */
		this.stopButton.style = 'padding: 0px, 6px, 0px, 6px; margin-left: 2px; margin-right: 46px;';

		/* Assemble playback controls */
		this.controlsButtonBox.add(this.repeatButton);
		this.controlsButtonBox.add(this.stopButton);
		this.controlsButtonBox.add(this.skipBackwardButton);
		this.controlsButtonBox.add(this.seekBackwardButton);
		this.controlsButtonBox.add(this.playButton);
		this.controlsButtonBox.add(this.pauseButton);
		this.controlsButtonBox.add(this.seekForwardButton);
		this.controlsButtonBox.add(this.skipForwardButton);

		this.menu.addMenuItem(this.trackTitle);
		this.menu.addMenuItem(this.positionSlider);
		this.menu.addMenuItem(this.volumeSlider);
		this.popupBase.actor.add(this.controlsButtonBox);
		this.menu.addMenuItem(this.popupBase);

		/* We do not want to display both play and pause buttons at once */
		this.playButton.hide();

		/* Signals connections */
		this.positionSlider.connect('value-changed', () => this.positionSlider.delay = maxDelay);
		this.positionSlider.connect('drag-begin', () => this.positionSlider.busy = true);
		this.positionSlider.connect('drag-end', () => this.positionSliderAction());

		this.positionSliderAction = () =>
		{
			this.positionSlider.delay = minDelay;
			let action;

			if(this.positionSlider.isVolume) action = 'VOLUME';
			else action = 'SEEK';

			Temp.setRemoteAction(action, this.positionSlider.value.toFixed(3));
			this.positionSlider.busy = false;
		}

		if(isUnifiedSlider)
		{
			this.positionSlider.button.connect('clicked', () =>
			{
				this.positionSlider.delay = 0;
				this.positionSlider.isVolume ^= true;

				let statusContents = Temp.readFromFile(shared.statusPath);

				if(this.positionSlider.isVolume)
				{
					this.positionSlider.icon = this.positionSlider.volumeIcon;
					if(statusContents) this.setVolume(statusContents);
				}
				else
				{
					this.positionSlider.icon = this.positionSlider.defaultIcon;
					if(statusContents) this.setProgress(statusContents);
				}
			});
		}

		this.volumeSlider.connect('value-changed', () => this.volumeSlider.delay = maxDelay);
		this.volumeSlider.connect('drag-begin', () => this.volumeSlider.busy = true);
		this.volumeSlider.connect('drag-end', () => this.volumeSliderAction());

		this.volumeSliderAction = () =>
		{
			this.volumeSlider.delay = minDelay;
			Temp.setRemoteAction('VOLUME', this.volumeSlider.value.toFixed(3));
			this.volumeSlider.busy = false;
		}

		this.repeatButton.connect('clicked', () =>
		{
			Temp.setRemoteAction('REPEAT', this.repeatButton.turnedOn);
			isRepeatActive = this.repeatButton.turnedOn;
		});

		this.playButton.connect('clicked', () => Temp.setRemoteAction('PLAY'));
		this.pauseButton.connect('clicked', () => Temp.setRemoteAction('PAUSE'));
		this.seekForwardButton.connect('clicked', () => Temp.setRemoteAction('SEEK+', seekTime));
		this.seekBackwardButton.connect('clicked', () => Temp.setRemoteAction('SEEK-', seekTime));
		this.stopButton.connect('clicked', () => Temp.setRemoteAction('STOP'));
		this.skipBackwardButton.connect('clicked', () => Temp.setRemoteAction('SKIP-'));
		this.skipForwardButton.connect('clicked', () => Temp.setRemoteAction('SKIP+'));

		this.statusFile = Gio.file_new_for_path(shared.statusPath);
		this.statusMonitor = this.statusFile.monitor(Gio.FileMonitorEvent.CHANGED, null);

		this.updateRemote = () =>
		{
			if(this.mode == 'PICTURE') return;

			let statusContents = Temp.readFromFile(shared.statusPath);
			if(statusContents)
			{
				if(	statusContents.hasOwnProperty('repeat')
					&& isRepeatActive !== statusContents.repeat
				) {
					isRepeatActive = (statusContents.repeat === true) ? true : false;
				}

				if(this.repeatButton.turnedOn !== isRepeatActive)
					this.repeatButton.turnOn(isRepeatActive);

				this.checkPlaying(statusContents);

				if(this.positionSlider.delay > 0)
				{
					this.positionSlider.delay--;
					if(
						!this.positionSlider.busy
						&& this.positionSlider.delay == minDelay
					) {
						this.positionSliderAction();
					}
				}

				if(this.volumeSlider.delay > 0)
				{
					this.volumeSlider.delay--;
					if(
						!this.volumeSlider.busy
						&& this.volumeSlider.delay == minDelay
					) {
						this.volumeSliderAction();
					}
				}

				this.setVolume(statusContents);

				if(
					this.positionSlider.visible
					&& !this.positionSlider.isVolume
					&& this.positionSlider.delay == 0
					&& !this.positionSlider.busy
				) {
					this.setProgress(statusContents);
				}
			}
		}

		this.statusMonitor.connect('changed', () => this.updateRemote());

		/* Functions */
		this.setPlaying = (value) =>
		{
			if(value === true)
			{
				this.playButton.hide();
				this.pauseButton.show();
			}
			else if(value === false)
			{
				this.pauseButton.hide();
				this.playButton.show();
			}
		}

		this.checkPlaying = (statusContents) =>
		{
			if(statusContents.playerState == 'PLAYING') this.setPlaying(true);
			else if(statusContents.playerState == 'PAUSED') this.setPlaying(false);
		}

		this.setProgress = (statusContents) =>
		{
			if(statusContents.mediaDuration > 0)
			{
				let sliderValue = statusContents.currentTime / statusContents.mediaDuration;
				this.positionSlider.setValue(sliderValue);
			}
		}

		this.setVolume = (statusContents) =>
		{
			if(statusContents.volume >= 0 && statusContents.volume <= 1)
			{
				if(
					this.volumeSlider.visible
					&& this.volumeSlider.delay == 0
					&& !this.volumeSlider.busy
				) {
					this.volumeSlider.setValue(statusContents.volume);
				}
				else if(
					this.positionSlider.isVolume
					&& this.positionSlider.delay == 0
					&& !this.positionSlider.busy
				) {
					this.positionSlider.setValue(statusContents.volume);
				}
			}
		}

		this.setShownRemoteItems = (itemsArray) =>
		{
			changableItems.forEach(item =>
			{
				if(this.hasOwnProperty(item))
				{
					if(itemsArray.includes(item))
						this[item].show();
					else
						this[item].hide();
				}
			});
		}

		this.setMode = (value, icon) =>
		{
			this.mode = value;
			let shownItems = [];

			switch(this.mode)
			{
				case 'DIRECT':
					shownItems = ['positionSlider', 'repeatButton', 'pauseButton',
						'seekBackwardButton', 'seekForwardButton'];
					if(!isUnifiedSlider) shownItems.push('volumeSlider');
					this.setShownRemoteItems(shownItems);
					break;
				case 'ENCODE':
					shownItems = ['volumeSlider', 'repeatButton', 'pauseButton'];
					this.setShownRemoteItems(shownItems);
					break;
				case 'PICTURE':
					this.setShownRemoteItems(shownItems);
					break;
				case 'LIVE':
					shownItems = ['volumeSlider', 'pauseButton'];
					this.setShownRemoteItems(shownItems);
					break;
				default:
					break;
			}

			if(icon) this.positionSlider.defaultIcon = icon;
		}

		this.setMediaButtonsSize = (size) =>
		{
			this.playButton.child.icon_size = size;
			this.pauseButton.child.icon_size = size;
			this.stopButton.child.icon_size = size;
			this.seekBackwardButton.child.icon_size = size;
			this.seekForwardButton.child.icon_size = size;
			this.skipBackwardButton.child.icon_size = size;
			this.skipForwardButton.child.icon_size = size;
			this.repeatButton.child.icon_size = size;
		}

		this.setSlidersIconSize = (size) =>
		{
			this.positionSlider.setIconSize(size);
			this.volumeSlider.setIconSize(size);
		}
	}

	hide()
	{
		this.actor.hide();
	}

	show()
	{
		this.actor.show();
	}

	destroy()
	{
		super.destroy();
	}
}

class PopupBase extends PopupMenu.PopupBaseMenuItem
{
	constructor()
	{
		super({ hover: false, reactive: true });
		this.actor.add_style_pseudo_class = () => { return null };
	}
}

class MediaControlButton extends St.Button
{
	constructor(icon, toggle, size)
	{
		if(!size) size = 20;

		super({
			style: 'padding: 4px, 6px, 4px, 6px; margin-left: 2px; margin-right: 2px;',
			opacity: 130,
			child: new St.Icon({ style_class: 'popup-menu-icon', icon_size: size, icon_name: icon })
		});

		this.turnedOn = false;

		let callback = () =>
		{
			if(!this.turnedOn) this.opacity = !this.reactive ? 30 : this.hover ? 255 : 130;
			else this.opacity = 255;
		}

		let changeState = () =>
		{
			if(toggle)
			{
				this.turnedOn = !this.turnedOn;
				if(this.turnedOn) this.opacity = 255;
				else this.opacity = 130;
			}
		}

		let signalIds = [
			this.connect('notify::hover', callback),
			this.connect('notify::reactive', callback),
			this.connect('clicked', changeState),
			this.connect('destroy', () => {
				signalIds.forEach(signalId => this.disconnect(signalId));
				this.turnedOn = null;
			})
		];

		/* Functions */
		this.turnOn = (value) =>
		{
			if(value === true)
			{
				this.opacity = 255;
				this.turnedOn = true;
			}
			else if(value === false)
			{
				this.opacity = 130;
				this.turnedOn = false;
			}
		}
	}
}

class SliderItem extends PopupMenu.PopupBaseMenuItem
{
	constructor(icon, toggle)
	{
		super({ hover: false, reactive: true });
		this.defaultIcon = icon;
		this.volumeIcon = 'audio-volume-high-symbolic';
		this._toggle = toggle;
		this._slider = new Slider.Slider(0);

		if(this._toggle) this.button = new MediaControlButton(this.defaultIcon, false, 16);
		else this.button = new St.Icon({ style_class: 'popup-menu-icon', icon_size: 16, icon_name: icon });

		this.delay = 0;
		this.busy = false;
		this.isVolume = false;

		this.actor.add(this.button);
		this.actor.add(this._slider.actor, { expand: true });
		this.actor.add_style_pseudo_class = () => { return null };
		this.actor.visible = true;

		this.button.style = 'margin-right: 2px;';

		/* Functions */
		this.setIconSize = (size) =>
		{
			if(this._toggle) this.button.child.icon_size = size;
			else this.button.icon_size = size;
		}

		this.setValue = (value) => this._slider.setValue(value);
		this.hide = () => this.actor.hide();
		this.show = () => this.actor.show();
		this.connect = (signal, callback) => this._slider.connect(signal, callback);
	}

	get value()
	{
		return this._slider.value;
	}

	get visible()
	{
		return this.actor.visible;
	}

	set icon(value)
	{
		if(this._toggle) this.button.child.icon_name = value;
		else this.button.icon_name = value;
	}
}

class trackTitleItem extends PopupMenu.PopupBaseMenuItem
{
	constructor()
	{
		super({ hover: false, reactive: true });
		this._title = new St.Label({ text: "", x_align: Clutter.ActorAlign.CENTER, x_expand: true });

		this.actor.add(this._title);
		this.actor.add_style_pseudo_class = () => { return null };
	}

	set text(value)
	{
		this._title.text = value;
	}
}
