//vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

// Cinnamon Window List
// Authors:
//   Kurt Rottmann <kurtrottmann@gmail.com>
//   Jason Siefken
//   Josh hess < jake.phy@gmail.com

// Taking code from
// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+
// http://intgat.tigress.co.uk/rmy/extensions/gnome-Cinnamon-frippery-0.2.3.tgz
const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
//const AppIcon = imports.ui.appIcon;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Signals = imports.signals;
const DND = imports.ui.dnd;
const AppFavorites = imports.ui.appFavorites;

const PANEL_ICON_SIZE = 24;
const SPINNER_ANIMATION_TIME = 1;
const THUMBNAIL_DEFAULT_SIZE = 150;
const HOVER_MENU_DELAY = 1; // seconds

// Load our extension so we can access other files in our extensions dir as libraries
const AppletDir = imports.ui.appletManager.applets['WindowListGroup@jake.phy@gmail.com'];
const SpecialMenus = AppletDir.specialMenus;
const SpecialButtons = AppletDir.specialButtons;

const OPTIONS = {
                    // DISPLAY_TITLE
                    //     TITLE: display the app title next to each icon
                    //     APP: display the app name next to each icon
                    //     NONE: display no text next to each icon
                    // Note, this option only applies when app grouping is enabled
                    DISPLAY_TITLE: 'NONE',
                    // GROUP_BY_APP
                    //     true: only one button is shown for each application (all windows are grouped)
                    //     false: every window has its own button
                    GROUP_BY_APP: true,
                    // DISPLAY_APP_NUMBER
                    //     SMART: show a number if there is more than one window in a app-group
                    //     NORM: show the number of window in a app-group
                    //     NONE: Don't display number
                    DISPLAY_APP_NUMBER: 'NORM',
                    // SHOW_FAVORITES
                    //     true: show
                    //     false: hide
                    SHOW_FAVORITES: true,
                    // THUMBNAIL_SIZE
                    //     Float or Integer; A lower number means a bigger thumbnail
                    THUMBNAIL_SIZE: 7
                };

// Globally variables needed for disabling the extension
let windowListManager, restoreState={}, clockWrapper, appTracker;



// Some functional programming tools
const dir = function(obj){
    let props = [a for (a in obj)];
    props.concat(Object.getOwnPropertyNames(obj));
    return props;
}

const range = function(a, b) {
    let ret = []
    // if b is unset, we want a to be the upper bound on the range
    if (b == null) {
        [a, b] = [0, a]
    }

    for (let i = a; i < b; i++) {
        ret.push(i);
    }
    return ret;
}

const zip = function(a, b) {
    let ret = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        ret.push([a[i], b[i]]);
    }
    return ret;
}

const unzip = function(a) {
    let ret1 = [], ret2 = [];
    a.forEach(function(tuple) {
        ret1.push(tuple[0]);
        ret2.push(tuple[1]);
    });

    return [ret1, ret2];
}

// A hash-like object that preserves order
// and is sortable
function OrderedHash() {
    this._init.apply(this, arguments);
}

OrderedHash.prototype = {
    _init: function(keys, items) {
        this._items = items || [];
        this._keys = keys || [];
    },

    toString: function() {
        let ret = [ this._keys[i] + ': ' + this._items[i] for each (i in range(this._keys.length)) ];
        return '{' + ret.join(', ') + '}';
    },

    set: function(key, val) {
        let i = this._keys.indexOf(key);
        if (i == -1) {
            this._keys.push(key);
            this._items.push(val);
        } else {
            this._items[i] = val;
        }
        return val;
    },

    // Given an array of keys, the entries [key: initializer(key)]
    // are added
    setKeys: function(keys, initializer) {
        keys.forEach(Lang.bind(this, function(key) {
            this.set(key, initializer(key));
        }));
    },

    get: function(key) {
        let i = this._keys.indexOf(key);
        if (i == -1) {
            return undefined;
        }
        return this._items[i];
    },

    // returns [key, items] corresponding
    // to the index
    getPair: function(index) {
        index = index || 0;
        return [this._keys[index], this._items[index]];
    },

    contains: function(key) {
        return this._keys.indexOf(key) != -1;
    },

    remove: function(key) {
        let i = this._keys.indexOf(key);
        let ret = null;
        if (i != -1) {
            this._keys.splice(i, 1);
            ret = this._items.splice(i, 1)[0];
        }
        return ret;
    },

    keys: function() {
        return this._keys.slice();
    },

    items: function() {
        return this._items.slice();
    },

    sort: function(sortFunc) {
        this.sortByKeys(sortFunc);
    },

    sortByKeys: function(sortFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.sort(Lang.bind(this, function(a, b) {
           return sortFunc(a[0], b[0]);
        }));
        [this._keys, this._items] = unzip(pairs);
    },

    sortByItems: function(sortFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.sort(Lang.bind(this, function(a, b) {
           return sortFunc(a[1], b[1]);
        }));
        [this._keys, this._items] = unzip(pairs);
    },

    // Call forFunc(key, item) on each (key, item) pair.
    forEach: function(forFunc) {
        let pairs = zip(this._keys, this._items);
        pairs.forEach(function(a) {
            forFunc(a[0], a[1]);
        });
    }
};

// Connects and keeps track of signal IDs so that signals
// can be easily disconnected
function SignalTracker() {
    this._init.apply(this, arguments);
}

SignalTracker.prototype = {
    _init: function() {
        this._data = [];
    },

    // params = {
    //              signalName: Signal Name
    //              callback: Callback Function
    //              bind: Context to bind to
    //              object: object to connect to
    //}
    connect: function(params) {
        let signalName = params['signalName'];
        let callback = params['callback'];
        let bind = params['bind'];
        let object = params['object'];
        let signalID = null;

        signalID = object.connect(signalName, Lang.bind(bind, callback));
        this._data.push({
            signalName: signalName,
            callback: callback,
            object: object,
            signalID: signalID,
            bind: bind
        });
    },

    disconnect: function(param) {

    },

    disconnectAll: function() {
        this._data.forEach(function(data) {
            data['object'].disconnect(data['signalID']);
            for (let prop in data) {
                data[prop] = null;
            }
        });
        this._data = [];
    }
};

// Tracks what applications are associated with the
// given metawindows.  Will return tracker.get_window_app
// if it is non-null.  Otherwise, it will look it up in
// its internal database.  If that fails, it will throw an exception
// This is a work around for https://bugzilla.gnome.org/show_bug.cgi?id=666472
function AppTracker() {
    this._init.apply(this, arguments);
}

AppTracker.prototype = {
    _init: function(tracker) {
        this.tracker = tracker || Cinnamon.WindowTracker.get_default();
        this.hash = new OrderedHash();
    },

    get_window_app: function(metaWindow) {
        let app = this.tracker.get_window_app(metaWindow);
        // If we found a valid app, we should add it to our hash,
        // otherwise, try to look it up in our hash
        if (app == null) {
            app = this.hash.get(metaWindow);
        } else {
            this.hash.set(metaWindow, app);
        }

        if (!app)
            throw { name: 'AppTrackerError', message: 'get_window_app returned null and there was no record of metaWindow in internal database' };

        return app;
    },

    is_window_interesting: function(metaWindow) {
        return this.tracker.is_window_interesting(metaWindow);
    }
};

// AppGroup is a container that keeps track
// of all windows of @app (all windows on workspaces
// that are watched, that is).
function AppGroup() {
    this._init.apply(this, arguments);
}

AppGroup.prototype = {
    _init: function(applet, app, isFavapp, orientation) {
        this.orientation = orientation;
        this.app = app;
        this.isFavapp = isFavapp;
        this._applet = applet;
        this.metaWindows = new OrderedHash();
        this.metaWorkspaces = new OrderedHash();
        this.actor = new St.Bin({ reactive: true,
                                  can_focus: true,
                                  x_fill: true,
                                  y_fill: false,
                                  track_hover: true });
        this.actor._delegate = this;
        this.actor.isFav = isFavapp;

        this._windowButtonBox = new SpecialButtons.ButtonBox();
        this._appButton = new SpecialButtons.AppButton({ isFavapp: this.isFavapp,     
                                                         app: this.app,
                                                         iconSize: PANEL_ICON_SIZE });
        this.myactor = new St.BoxLayout({ reactive: true });
        this.actor.set_child(this.myactor);
        this.myactor.add(this._appButton.actor);
        this.myactor.add(this._windowButtonBox.actor);

        this.appButtonVisible = true;
        this.windowButtonsVisible = true;

        this._appButton.actor.connect('button-release-event', Lang.bind(this, this._onAppButtonRelease));
        // Set up the right click menu for this._appButton
        this.rightClickMenu = new AppletDir.specialMenus.AppMenuButtonRightClickMenu(this._appButton.actor, this.metaWindow, this.app, isFavapp, orientation);
        this._menuManager = new PopupMenu.PopupMenuManager({actor: this.actor});
        this._menuManager.addMenu(this.rightClickMenu);

       // Set up the hover menu for this._appButton
        this.hoverMenu = new AppletDir.specialMenus.AppThumbnailHoverMenu(this.actor, this.metaWindow, this.app, isFavapp, orientation)
        this._hoverMenuManager = new SpecialMenus.HoverMenuController({actor: this.actor});
        this._hoverMenuManager.addMenu(this.hoverMenu);

        this._calcWindowNumber();
        this._loadWinBoxFavs();

        this._draggable = SpecialButtons.makeDraggable(this.actor);
        this._draggable.connect('drag-begin', Lang.bind(this, this._onDragBegin));
        this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragCancelled));
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));

            this.on_panel_edit_mode_changed();
        global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));                                                        
    },

    on_panel_edit_mode_changed: function() {
        this._draggable.inhibit = global.settings.get_boolean("panel-edit-mode");
    }, 
        
    _onDragBegin: function() {
        this.rightClickMenu.close(false);
        this.hoverMenu.close(false);
    },

    _onDragEnd: function() {
        this.rightClickMenu.close(false);
        this.hoverMenu.close(false);
        this._applet.myactorbox._clearDragPlaceholder();
    },

    _onDragCancelled: function() {
        this.rightClickMenu.close(false);
        this.hoverMenu.close(false);
        this._applet.myactorbox._clearDragPlaceholder();
    },

    getDragActor: function() {
        return new Clutter.Clone({ source: this.actor });
    },

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource: function() {
        return this.actor;
    },

    // Add a workspace to the list of workspaces that are watched for
    // windows being added and removed
    watchWorkspace: function(metaWorkspace) {
        if (!this.metaWorkspaces.contains(metaWorkspace)) {
            // We use connect_after so that the window-tracker time to identify the app, otherwise get_window_app might return null!
            let windowAddedSignal = metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded));
            let windowRemovedSignal = metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved));
            this.metaWorkspaces.set(metaWorkspace, { workspace: metaWorkspace,
                                                     signals: [windowAddedSignal, windowRemovedSignal] });
        }
    },

    // Stop monitoring a workspace for added and removed windows.
    // @metaWorkspace: if null, will remove all signals
    unwatchWorkspace: function(metaWorkspace) {
        function removeSignals(obj) {
            obj.signals.forEach(function(s) {
                obj.workspace.disconnect(s);
            });
        }

        if (metaWorkspace == null) {
            for each (let k in this.metaWorkspaces.keys()) {
                removeSignals(this.metaWorkspaces.get(k));
                this.metaWorkspaces.remove(k);
            }
        } else if (this.metaWorkspaces.contains(metaWorkspace)) {
            removeSignals(this.metaWorkspaces.get(metaWorkspace));
            this.metaWorkspaces.remove(metaWorkspace);
        } else {
            global.log('Warning: tried to remove watch on an unwatched workspace');
        }
    },

    hideWindowButtons: function(animate) {
        this._windowButtonBox.hide(animate);
        this.windowButtonsVisible = false;
    },

    showWindowButtons: function(animate) {
        let targetWidth = null;
        if (animate)
            targetWidth = this.actor.width;
        this._windowButtonBox.show(animate, targetWidth);
        this.windowButtonsVisible = true;
    },

    hideAppButton: function(animate) {
        this._appButton.hide(animate);
        this.appButtonVisible = false;
    },

    showAppButton: function(animate) {
        let targetWidth = null;
        if (animate)
            targetWidth = this.actor.width;
        this._appButton.show(animate, targetWidth);
        this.appButtonVisible = true;
    },

    hideAppButtonLabel: function(animate) {
        this._appButton.hideLabel(animate)
    },

    showAppButtonLabel: function(animate) {
        this._appButton.showLabel(animate)
    },

    _onAppButtonRelease: function(actor, event) {
        if (Cinnamon.get_event_state(event) & Clutter.ModifierType.BUTTON1_MASK && this.isFavapp) {
	        this.app.open_new_window(-1);
                this._animate();
                return;
        }
        if (!this.lastFocused)
            return;

        if (Cinnamon.get_event_state(event) & Clutter.ModifierType.BUTTON1_MASK) {
            if (this.rightClickMenu && this.rightClickMenu.isOpen) {
                this.rightClickMenu.toggle();
            }
            this._windowHandle(false);
        }else if (Cinnamon.get_event_state(event) & Clutter.ModifierType.BUTTON2_MASK && !this.isFavapp) {
            this.lastFocused.delete(global.get_current_time());
        }  
    },

    _windowHandle: function(fromDrag){
            if ( this.lastFocused.has_focus() ) {
                if (fromDrag){
                        return;
                }
                this.lastFocused.minimize(global.get_current_time());
            }else {
                if (this.lastFocused.minimized) {
                    this.lastFocused.unminimize(global.get_current_time()); 
                }
                this.lastFocused.activate(global.get_current_time());
            }
    },

    _getLastFocusedWindow: function() {
        // Get a list of windows and sort it in order of last access
        let list = [ [win.user_time, win] for each (win in this.metaWindows.keys()) ]
        list.sort(function(a,b) { return a[0] - b[0]; });
        if (list[0])
            return list[0][1];
        else
            return null
    },

    // updates the internal list of metaWindows
    // to include all windows corresponding to this.app on the workspace
    // metaWorkspace
    _updateMetaWindows: function(metaWorkspace) {
        let tracker = Cinnamon.WindowTracker.get_default();
        // Get a list of all interesting windows that are part of this app on the current workspace
        let windowList = metaWorkspace.list_windows().filter(Lang.bind(this, function(metaWindow) {
            try {
                return tracker.get_window_app(metaWindow) == this.app && tracker.is_window_interesting(metaWindow);
            } catch (e) {
                log(e.name + ': ' + e.message);
                return false;
            }
        }));
        this.metaWindows = new OrderedHash();
        this._windowButtonBox.clear();
        this._loadWinBoxFavs();
        windowList.forEach(Lang.bind(this, function(win) {
            this._windowAdded(null, win);
        }));

        // When we first populate we need to decide which window
        // will be triggered when the app button is pressed
        if (!this.lastFocused) {
            this.lastFocused = this._getLastFocusedWindow();
        }
        if (this.lastFocused) {
            this._windowTitleChanged(this.lastFocused);
            this.hoverMenu.setMetaWindow(this.lastFocused);
            this.rightClickMenu.setMetaWindow(this.lastFocused);
        }
    },
                
    _windowAdded: function(metaWorkspace, metaWindow) {
        let tracker = Cinnamon.WindowTracker.get_default();
        if (tracker.get_window_app(metaWindow) == this.app && !this.metaWindows.contains(metaWindow) && tracker.is_window_interesting(metaWindow)) {
            let button = new SpecialButtons.WindowButton({ app: this.app,
                                                           isFavapp: false,
                                                           metaWindow: metaWindow,
                                                           iconSize: PANEL_ICON_SIZE,
                                                           textOffsetFactor: 1,
                                                           orientation: this.orientation});
            if (this.isFavapp){
                this._makeNormalapp();
            }
            this._windowButtonBox.add(button);
            let signals = [];
            signals.push(metaWindow.connect('notify::title', Lang.bind(this, this._windowTitleChanged)));
            signals.push(metaWindow.connect('notify::appears-focused', Lang.bind(this, this._focusWindowChange)));
            let data = { signals: signals,
                         windowButton: button };
            this.metaWindows.set(metaWindow, data);
            this.metaWindows.sort(function(w1, w2) {
                return w1.get_stable_sequence() - w2.get_stable_sequence();
            });
        }
        this._calcWindowNumber();
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        let deleted = this.metaWindows.remove(metaWindow);
        if (deleted != null) {
            // Clean up all the signals we've connected
            deleted['signals'].forEach(function(s) {
                metaWindow.disconnect(s);
            });
            this._windowButtonBox.remove(deleted['windowButton']);
            deleted['windowButton'].destroy();

            // Make sure we don't leave our appButton hanging!
            // That is, we should no longer display the old app in our title
            let nextWindow = this.metaWindows.keys()[0];
            if (nextWindow) {
                this.lastFocused = nextWindow;
                this._windowTitleChanged(this.lastFocused);
                this.hoverMenu.setMetaWindow(this.lastFocused);
                this.rightClickMenu.setMetaWindow(this.lastFocused);
            }
        this._calcWindowNumber();
        }
    },

    _windowTitleChanged: function(metaWindow) {
        // We only really want to track title changes of the last focused app
        if (metaWindow != this.lastFocused)
            return;
        if (!this._appButton) {
            throw 'Error: got a _windowTitleChanged callback but this._appButton is undefined';
            return;
        }

        let [title, appName] = [metaWindow.get_title(), this.app.get_name()];
        switch(OPTIONS['DISPLAY_TITLE']) {
            case 'TITLE':
                // Some apps take a long time to set a valid title.  We don't want to error
                // if title is null
                if (title) {
                    this._appButton.setText(title);
                    break;
                }
            case 'APP':
                if (appName) {
                    this._appButton.setText(appName);
                    break;
                }
            case 'NONE':
            default:
                this._appButton.setText('');
        }
    },

    _focusWindowChange: function(metaWindow) {
        if (metaWindow.appears_focused) {
            this.lastFocused = metaWindow;
            this._windowTitleChanged(this.lastFocused);
            this.hoverMenu.setMetaWindow(this.lastFocused);
            this.rightClickMenu.setMetaWindow(this.lastFocused);
        }
        this._updateFocusedStatus();
    },

    // Monitors whether any windows of this.app have focus
    // Emits a focus-status-change event if this chagnes
    _updateFocusedStatus: function() {
        let changed = false;
        let focusState = this.metaWindows.keys().some(function(win) { return win.appears_focused; });
        if (this.focusState !== focusState) {
            this.emit('focus-state-change', focusState);
        }
        this.focusState = focusState;
    },
    
    _loadWinBoxFavs: function() {
        if (this.isFavapp || this.wasFavapp) {
            let button = new SpecialButtons.WindowButton({ app: this.app,
                                                           isFavapp: true,
                                                           metaWindow: null,
                                                           iconSize: PANEL_ICON_SIZE,
                                                           textOffsetFactor: 1,
                                                           orientation: this.orientation});
            this._windowButtonBox.add(button);
        }
    },
    
    _makeNormalapp: function() {
        this.wasFavapp = true;
        this.isFavapp = false;
        this._appButton.actor.set_style_class_name('window-list-item-box');
	this.rightClickMenu.removeAll();
        this.rightClickMenu._makeNormalapp();
        this.hoverMenu.appSwitcherItem._makeNormalapp();
    },
    
    _makeFavapp: function() {
        this.wasFavapp = false;
        this.isFavapp = true;
        this._appButton.actor.set_style_class_name('panel-launcher')
        this._appButton.setText('');
	this.rightClickMenu.removeAll();
        this.rightClickMenu._makeFavapp();
        this.hoverMenu.appSwitcherItem._makeFavapp();
    },

    _calcWindowNumber: function() {
        let windowNum = this.app.get_windows().length;
        if (!windowNum)
           windowNum = 0;
	this._appButton._numLabel.set_text(windowNum.toString());
        switch(OPTIONS['DISPLAY_APP_NUMBER']) {
            case 'SMART':
                if (windowNum <= 1) {
                        this._appButton._numLabel.hide();
                    break;
                }else{
                        this._appButton._numLabel.show();
                    break;
                }
            case 'NORM':
                if (windowNum) {
                        this._appButton._numLabel.show();
                    break;
                }
            case 'NONE':
            default:
                this._appButton._numLabel.hide();
        }
    },

    _animate: function() {
	this.actor.set_z_rotation_from_gravity(0.0, Clutter.Gravity.CENTER)
        Tweener.addTween(this.actor,
                         { opacity: 70,
			   time: 1.0,
                           transition: "linear",
                           onCompleteScope: this,
                           onComplete: function() {
       	 			Tweener.addTween(this.actor,
                	        		 { opacity: 255,
						   time: 0.5,
                	        		   transition: "linear"
                	        		 });
                           }
                         });
    },

    destroy: function() {
        // Unwatch all workspaces before we destroy all our actors
        // that callbacks depend on
        this.unwatchWorkspace(null);
        this.metaWindows.forEach(function(win, data) {
            data['signals'].forEach(function(s) {
                win.disconnect(s);
            });
        });

        this._appButton.destroy();
        this._windowButtonBox.destroy();
        this.actor.destroy();
        this._appButton = null;
        this._windowButtonBox = null;
        this.actor = null;
    }
};
Signals.addSignalMethods(AppGroup.prototype)

// List of running apps
function AppList() {
    this._init.apply(this, arguments);
}

AppList.prototype = {
    _init: function(applet, metaWorkspace, orientation) {
        this.orientation = orientation;
        this._applet = applet;

        this.actor = new St.BoxLayout({ reactive: true, track_hover: true });

                this.myactorbox = new SpecialButtons.MyAppletBox(this);
                this.myactor = this.myactorbox.actor;
                
                this.actor.add(this.myactor);

                if (orientation == St.Side.TOP) {
                        this.myactor.add_style_class_name('window-list-box-top');
                        this.myactor.set_style('margin-top: 0px;');
                        this.myactor.set_style('padding-top: 0px;');
                        //this.myactor.set_style('padding-left: 3px');
                }
                else {
                        this.myactor.add_style_class_name('window-list-box-bottom');
                        this.myactor.set_style('margin-bottom: 0px;');
                        this.myactor.set_style('padding-bottom: 0px;');
                        //this.myactor.set_style('padding-left: 3px');
                }

        this.metaWorkspace = metaWorkspace;
        this._appList = new OrderedHash();
        // We need a backup database of the associated app for each metaWindow since something get_window_app will return null
        this._tracker = new AppTracker(Cinnamon.WindowTracker.get_default());
        this._refreshApps();
        this._loadFavorites();
        this.signals = [];
        // We use connect_after so that the window-tracker time to identify the app
        this.signals.push(this.metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded)));
        this.signals.push(this.metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved)));

        this.signals.push(Cinnamon.AppSystem.get_default().connect('installed-changed', Lang.bind(this, function() {
                                                        Mainloop.timeout_add(0, Lang.bind(this, this._refreshList))})));
        this.signals.push(AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, function() {
                                                        Mainloop.timeout_add(0, Lang.bind(this, this._refreshList))})));

        global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed)); 
    },

    on_panel_edit_mode_changed: function() {
        this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    }, 

    // Gets a list of every app on the current workspace
    _refreshApps: function() {
        //let tracker = Cinnamon.WindowTracker.get_default();
        let tracker = this._tracker;

        // For eachw window, let's make sure we add it!
        this.metaWorkspace.list_windows().forEach(Lang.bind(this, function(win) {
            this._windowAdded(this.metaWorkspace, win);
        }));
    },

    _refreshList: function () {
        this.myactor.destroy_children();
        this._appList = new OrderedHash();
        this._loadFavorites();
        this._refreshApps();
    },

    _windowAdded: function(metaWorkspace, metaWindow, favapp, isFavapp) {
        // Check to see if the window that was added already has an app group.
        // If it does, then we don't need to do anything.  If not, we need to
        // create an app group.
        //let tracker = Cinnamon.WindowTracker.get_default();
        let tracker = this._tracker;
        let app;
        try {
            if (favapp)
                app = favapp;
            else
                app = tracker.get_window_app(metaWindow);
        } catch (e) {
            log(e.name + ': ' + e.message);
            return;
        }
        if (!this._appList.contains(app)) {
            let appGroup = new AppGroup(this, app, isFavapp, this.orientation);
            appGroup._updateMetaWindows(metaWorkspace);
            appGroup.watchWorkspace(metaWorkspace);

            if (OPTIONS['GROUP_BY_APP']) {
                appGroup.hideWindowButtons();
            } else {
                appGroup.hideAppButton();
            }

            this.myactor.add_actor(appGroup.actor);

            // We also need to monitor the state 'cause some pesky apps (namely: plugin_container left over after fullscreening a flash video)
            // don't report having zero windows after they close
            let appStateSignal = app.connect('notify::state', Lang.bind(this, function(app) {
                if (app.state == Cinnamon.AppState.STOPPED && this._appList.contains(app) && !isFavapp) {
                    this._removeApp(app);
                }
            }));

            this._appList.set(app, { appGroup: appGroup, signals: [appStateSignal] });
            // TODO not quite ready yet for prime time
            /* appGroup.connect('focus-state-change', function(group, focusState) {
                if (focusState) {
                    group.showAppButtonLabel(true);
                } else {
                    group.hideAppButtonLabel(true);
                }
            }); */
        }
    },

    _removeApp: function(app) {
        // This function may get called multiple times on the same app and so the app may have already been removed
        let appGroup = this._appList.get(app);
        if (appGroup) {
            if (appGroup['appGroup'].wasFavapp || appGroup['appGroup'].isFavapp) {
               appGroup['appGroup']._makeFavapp();
               return;
            }
            this._appList.remove(app);
            appGroup['appGroup'].destroy();
            appGroup['signals'].forEach(function(s) {
                app.disconnect(s);
            });
        }
    },



    _loadFavorites: function() {
	if (!OPTIONS['SHOW_FAVORITES'])
                return;
        let launchers = global.settings.get_strv('favorite-apps'),
            appSys = Cinnamon.AppSystem.get_default(),
	    i = 0,
	    app;
	while(i < launchers.length) {
		app = appSys.lookup_app(launchers[i]);
                if(!app) app = appSys.lookup_settings_app(launchers[i]);
		if(!app)
			continue;
                this._windowAdded(this.metaWorkspace, null, app, true)
                i++;
	}
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        // When a window is closed, we need to check if the app it belongs
        // to has no windows left.  If so, we need to remove the corresponding AppGroup
        //let tracker = Cinnamon.WindowTracker.get_default();
        let tracker = this._tracker;
        let app;
        try {
            app = tracker.get_window_app(metaWindow);
        } catch (e) {
            log(e.name + ': ' + e.message);
            return;
        }
        let hasWindowsOnWorkspace = app.get_windows().some(function(win) { return win.get_workspace() == metaWorkspace; });
        if (app && !hasWindowsOnWorkspace) {
            this._removeApp(app);
        }
    },

    destroy: function() {
        this.signals.forEach(Lang.bind(this, function(s) {
            this.metaWorkspace.disconnect(s);
        }));

        this._appList.forEach(function(app, data) {
            data['appGroup'].destroy();
        });
        this._appList = null;
    }
};

// Manages window/app lists and takes care of
// hiding/showing them and manages switching workspaces, etc.
function MyApplet(orientation) {
    this._init(orientation);
}

MyApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function(orientation) {        
        Applet.Applet.prototype._init.call(this, orientation);
        try { 
                this.orientation = orientation;
                this.dragInProgress = false;

                this._box = new St.Bin({ reactive: true, track_hover: true }); 
   
                this.actor.add(this._box);   
                this.actor.reactive = global.settings.get_boolean("panel-edit-mode");


                if (orientation == St.Side.TOP) {
                        this.actor.set_style('margin-top: 0px;');
                        this.actor.set_style('padding-top: 0px;');
                }
                else {
                        this.actor.set_style('margin-bottom: 0px;');
                        this.actor.set_style('padding-bottom: 0px;');
                }

   
                this.metaWorkspaces = new OrderedHash();
        
                // Use a signal tracker so we don't have to keep track of all these id's manually!
                //  global.window_manager.connect('switch-workspace', Lang.bind(this, this._onSwitchWorkspace));
                //  global.screen.connect('notify::n-workspaces', Lang.bind(this, this._onWorkspaceCreatedOrDestroyed));
                //  Main.overview.connect('showing', Lang.bind(this, this._onOverviewShow));
                //  Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHide));
                this.signals = new SignalTracker();
                this.signals.connect({ object: global.window_manager,
                                       signalName: 'switch-workspace',
                                       callback: this._onSwitchWorkspace,
                                       bind: this });
                this.signals.connect({ object: global.screen,
                                       signalName: 'notify::n-workspaces',
                                       callback: this._onWorkspaceCreatedOrDestroyed,
                                       bind: this });
                this.signals.connect({ object: Main.overview,
                                       signalName: 'showing',
                                       callback: this._onOverviewShow,
                                       bind: this });
                this.signals.connect({ object: Main.overview,
                                       signalName: 'hiding',
                                       callback: this._onOverviewHide,
                                       bind: this });
                this._onSwitchWorkspace(null, null, global.screen.get_active_workspace_index());

                global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed)); 
        }
        catch (e) {
            global.logError(e);
        }
    },
    
    on_applet_clicked: function(event) {
            
    },        
    
    on_panel_edit_mode_changed: function() {
        this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    }, 

    _onWorkspaceCreatedOrDestroyed: function() {
       let workspaces = [ global.screen.get_workspace_by_index(i) for each (i in range(global.screen.n_workspaces)) ];
       // We'd like to know what workspaces in this.metaWorkspaces have been destroyed and
       // so are no longer in the workspaces list.  For each of those, we should destroy them
       let toDelete = [];
       this.metaWorkspaces.forEach(Lang.bind(this, function(ws, data) {
            if (workspaces.indexOf(ws) == -1) {
                data['appList'].destroy();
                toDelete.push(ws);
            }
       }));
       toDelete.forEach(Lang.bind(this, function(item) {
            this.metaWorkspaces.remove(item);
       }));
    },

    _onSwitchWorkspace: function(winManager, previousWorkspaceIndex, currentWorkspaceIndex) {
        let metaWorkspace = global.screen.get_workspace_by_index(currentWorkspaceIndex);
        // If the workspace we switched to isn't in our list,
        // we need to create an AppList for it
        if (!this.metaWorkspaces.contains(metaWorkspace)) {
            let appList = new AppList(this, metaWorkspace, this.orientation);
            this.metaWorkspaces.set(metaWorkspace, { 'appList': appList });
        }

        // this.actor can only have one child, so setting the child
        // will automatically unparent anything that was previously there, which
        // is exactly what we want.
        this._box.set_child(this.metaWorkspaces.get(metaWorkspace)['appList'].actor);
    },

    _onOverviewShow: function() {
        this.actor.hide();
    },

    _onOverviewHide: function() {
        this.actor.show();
    },

    destroy: function() {
        this.signals.disconnectAll();
        this.actor.destroy();
        this.actor = null;
    }
};

function main(metadata, orientation) {  
    let myApplet = new MyApplet(orientation);
    return myApplet;      
}